class CheckBackupStatusJob < ApplicationJob
  queue_as :default

  def perform
    script_path = Rails.root.join("bin", "manage_backup")
    
    unless File.executable?(script_path)
      File.chmod(0755, script_path)
    end

    require 'open3'
    # Execute 'manage_backup latest' captures stdout
    stdout_str, stderr_str, status = Open3.capture3(script_path.to_s, "latest")

    if status.success?
      if stdout_str.present?
        # Output format: YYYY-MM-DD HH:MM:SS.nnnnnnnnn
        # We need to parse this.
        # rclone lsl output example: 2024-05-20 10:00:00.000000000
        timestamp_str = stdout_str.strip
        
        begin
          last_backup_at = Time.parse(timestamp_str)
          Rails.cache.write("last_backup_at", last_backup_at)
        rescue ArgumentError => e
          Rails.logger.error "CheckBackupStatusJob: Failed to parse timestamp '#{timestamp_str}': #{e.message}"
          return
        end
      else
        # No backup found
        Rails.cache.delete("last_backup_at")
        last_backup_at = nil
      end

      # Always update check time and broadcast
      Rails.cache.write("last_backup_check_at", Time.current)

      Turbo::StreamsChannel.broadcast_replace_to(
        "backup_status",
        target: "last_backup_time",
        partial: "layouts/shared/last_backup_time",
        locals: { last_backup_at: last_backup_at }
      )
    else
      Rails.logger.error "CheckBackupStatusJob failed: #{stderr_str}"
    end
  end
end
