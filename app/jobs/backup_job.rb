class BackupJob < ApplicationJob
  queue_as :default

  def perform
    # Execute the backup script
    # The script is expected to accept 'backup' as argument
    
    script_path = Rails.root.join("bin", "manage_backup")
    
    unless File.executable?(script_path)
      File.chmod(0755, script_path)
    end

    require 'open3'
    stdout_str, stderr_str, status = Open3.capture3(script_path.to_s, "backup")

    if status.success?
      Rails.logger.info "Backup completed successfully: #{stdout_str}"
      Rails.cache.write("last_backup_at", Time.current)
    else
      error_message = "Backup failed: #{stderr_str.presence || stdout_str}"
      Rails.logger.error error_message
      raise StandardError, error_message
    end
  end
end
