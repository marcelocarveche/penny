class BackupsController < ApplicationController
  include Notifiable

  def create
    BackupJob.perform_now
    
    respond_to do |format|
      format.turbo_stream do
        flash.now[:notice] = "Backup iniciado e enviado para o Google Drive com sucesso!"
        
        streams = flash_notification_stream_items
        streams << turbo_stream.replace("last_backup_time", partial: "layouts/shared/last_backup_time", locals: { last_backup_at: Time.current })
        
        render turbo_stream: streams
      end
    end
  rescue StandardError => e
    respond_to do |format|
      format.turbo_stream do
        flash.now[:alert] = "Erro ao realizar backup: #{e.message}"
        render turbo_stream: flash_notification_stream_items
      end
    end
  end

  def check
    # Rate limiting: Only check Google Drive at most once every 3 minutes
    # But ALWAYS update the UI with the cached time so the "X minutes ago" text stays fresh.
    last_check = Rails.cache.read("last_backup_check_at")
    
    if last_check.nil? || last_check < 3.minutes.ago
      CheckBackupStatusJob.perform_later
    end
    
    respond_to do |format|
      format.turbo_stream do
        render turbo_stream: turbo_stream.replace("last_backup_time", partial: "layouts/shared/last_backup_time")
      end
    end
  end
end
