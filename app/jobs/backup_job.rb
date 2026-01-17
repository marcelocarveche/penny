class BackupJob < ApplicationJob
  queue_as :default

  def perform
    # Execute the backup script
    # The script is expected to accept 'backup' as argument
    
    script_path = Rails.root.join("bin", "manage_backup")
    
    unless File.executable?(script_path)
      File.chmod(0755, script_path)
    end

    # Fetch token from Family (User-Linked Mode) OR fallback to ENV (Legacy Mode)
    # We assume the first family is the "Instance Owner" for simplicity in this context.
    family = Family.first
    token = family&.google_drive_config.presence || ENV["RCLONE_CONFIG_GDRIVE_TOKEN"]

    env_vars = {}
    if token.present?
      env_vars["RCLONE_CONFIG_GDRIVE_TOKEN"] = token
    else
       Rails.logger.warn "No Google Drive token found in Family config or ENV. Backup may fail if remote requires auth."
    end

    require 'open3'
    # Execute 'manage_backup' with the injected environment variable
    stdout_str, stderr_str, status = Open3.capture3(env_vars, script_path.to_s, "backup")

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
