import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

export default class extends Controller {
    static targets = ["button"]

    connect() {
        this.originalContent = this.buttonTarget.innerHTML

        // Check immediately on load
        this.checkStatus()

        // Poll every 60 seconds to update relative time text and background check
        this.startPolling()
    }

    disconnect() {
        this.stopPolling()
    }

    startPolling() {
        this.stopPolling()
        this.pollingInterval = setInterval(() => {
            this.checkStatus()
        }, 60000) // 1 minute
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval)
        }
    }

    async checkStatus() {
        const url = this.element.dataset.checkUrl
        if (url) {
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]').content,
                        "Accept": "text/vnd.turbo-stream.html"
                    }
                })

                if (response.ok) {
                    const html = await response.text()
                    Turbo.renderStreamMessage(html)
                }
            } catch (error) {
                console.error("Backup check failed:", error)
            }
        }
    }

    loading() {
        this.buttonTarget.classList.add("pointer-events-none")
        this.buttonTarget.innerHTML = `
      <svg class="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    `
    }

    reset() {
        this.buttonTarget.classList.remove("pointer-events-none")
        this.buttonTarget.innerHTML = this.originalContent
    }
}
