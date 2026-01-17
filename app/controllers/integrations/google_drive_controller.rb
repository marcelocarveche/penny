module Integrations
  class GoogleDriveController < ApplicationController
    skip_before_action :verify_authenticity_token, only: :create

    def create
      Rails.logger.info "=== Google Drive OAuth Callback Started ==="
      
      auth = request.env["omniauth.auth"]
      Rails.logger.info "Auth present: #{auth.present?}"
      Rails.logger.info "Current family: #{Current.family.inspect}"
      
      # Build the rclone config JSON structure
      # We need access_token, refresh_token, client_id, client_secret, expiry
      rclone_config = {
        access_token: auth.credentials.token,
        token_type: "Bearer",
        refresh_token: auth.credentials.refresh_token,
        expiry: Time.at(auth.credentials.expires_at).utc.iso8601
      }.to_json

      Rails.logger.info "Rclone config built: #{rclone_config[0..100]}..."
      
      # We store the FULL JSON blob that rclone expects for the 'token' field.
      # Rclone config example: token = {"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}
      
      result = Current.family.update!(google_drive_config: rclone_config)
      Rails.logger.info "Update result: #{result}"
      Rails.logger.info "google_drive_config after save: #{Current.family.reload.google_drive_config.present?}"
      Rails.logger.info "=== Google Drive OAuth Callback Completed ==="

      redirect_to settings_profile_path, notice: "Google Drive conectado com sucesso!"
    rescue StandardError => e
      Rails.logger.error "=== Google Drive OAuth Error ==="
      Rails.logger.error "Error: #{e.class} - #{e.message}"
      Rails.logger.error e.backtrace.join("\n")
      redirect_to settings_profile_path, alert: "Erro ao conectar Google Drive: #{e.message}"
    end

    def failure
      error_message = params[:message] || "Erro desconhecido"
      redirect_to settings_profile_path, alert: "Erro ao conectar Google Drive: #{error_message}"
    end

    def destroy
      Current.family.update!(google_drive_config: nil)
      redirect_to settings_profile_path, notice: "Google Drive desconectado."
    end
  end
end
