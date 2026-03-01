class ErrorHandler {
    constructor() {
        this.notificationSystem = new NotificationSystem();
    }

    handleError(error) {
        let errorMessage = '';
        let duration = 5000;

        if (typeof error === 'string') {
            errorMessage = error;
        } else if (error.response) {
            // Handle axios error responses
            const status = error.response.status;
            switch (status) {
                case 400:
                    errorMessage = 'Invalid request. Please check your input.';
                    break;
                case 403:
                    errorMessage = 'Access forbidden. The website may be blocking web scraping.';
                    break;
                case 404:
                    errorMessage = 'The requested resource was not found.';
                    break;
                case 429:
                    errorMessage = 'Too many requests. Please try again later.';
                    break;
                case 500:
                    errorMessage = 'Server error. Please try again later.';
                    break;
                default:
                    errorMessage = error.response.data?.error || 'An unexpected error occurred.';
            }
        } else if (error.request) {
            // Network error
            errorMessage = 'Network error. Please check your internet connection.';
        } else {
            // Default error message
            errorMessage = error.message || 'An unexpected error occurred.';
        }

        // Display error using notification system
        this.notificationSystem.error(errorMessage, duration);

        // Update UI elements if needed
        const errorAlert = document.getElementById('errorAlert');
        if (errorAlert) {
            errorAlert.textContent = errorMessage;
            errorAlert.classList.remove('d-none');
            setTimeout(() => {
                errorAlert.classList.add('d-none');
            }, duration);
        }
    }
}

// Create a singleton instance
const errorHandler = new ErrorHandler();