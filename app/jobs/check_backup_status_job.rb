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

    if status.success? && stdout_str.present?
      # Output format: YYYY-MM-DD HH:MM:SS.nnnnnnnnn
      # We need to parse this.
      # rclone lsl output example: 2024-05-20 10:00:00.000000000
      timestamp_str = stdout_str.strip
      
      begin
        # Use Time.parse (active_support extends it)
        # Assuming rclone returns UTC or local? rclone usually returns what the remote says.
        # Google Drive stores in UTC.
        # However, rclone lsl converts to local time unless --timezone is used? 
        # Actually usually it's best to assume UTC if uncertain, but let's try parsing.
        
        last_backup_at = Time.parse(timestamp_str)
        
        # Write to cache
        Rails.cache.write("last_backup_at", last_backup_at)
        Rails.cache.write("last_backup_check_at", Time.current)

        # Broadcast update
        Turbo::StreamsChannel.broadcast_replace_to(
          "backup_status",
          target: "last_backup_time",
          partial: "layouts/shared/last_backup_time",
          locals: { last_backup_at: last_backup_at }
        )
      rescue ArgumentError => e
        Rails.logger.error "CheckBackupStatusJob: Failed to parse timestamp '#{timestamp_str}': #{e.message}"
      end
    else
      Rails.logger.error "CheckBackupStatusJob failed: #{stderr_str}"
    end
  end
end
