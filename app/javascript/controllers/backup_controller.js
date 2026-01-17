import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
    static targets = ["button"]

    connect() {
        this.originalContent = this.buttonTarget.innerHTML

        // Trigger background status check if URL is provided
        if (this.element.dataset.checkUrl) {
            fetch(this.element.dataset.checkUrl, {
                method: "POST",
                headers: {
                    "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]').content
                }
            })
        }
    }

    loading() {
        this.buttonTarget.classList.add("pointer-events-none")
        this.buttonTarget.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-2 animate-spin text-gray-400"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
    `
    }

    reset() {
        this.buttonTarget.classList.remove("pointer-events-none")
        this.buttonTarget.innerHTML = this.originalContent
    }
}
