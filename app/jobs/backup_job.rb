class BackupJob < ApplicationJob
  queue_as :default

  def perform
    # Execute the backup script
    # The script is expected to accept 'backup' as argument
    
    script_path = Rails.root.join("bin", "manage_backup")
    
    unless File.executable?(script_path)
      File.chmod(0755, script_path)
    end

    system(*[script_path.to_s, "backup"])
  end
end
