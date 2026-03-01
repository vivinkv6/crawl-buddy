// Notification system for CrawlMate

class NotificationSystem {
    constructor() {
        this.container = document.getElementById('notificationContainer');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'notificationContainer';
            document.body.appendChild(this.container);
        }
    }

    show(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        // Create icon based on type
        const icon = document.createElement('i');
        switch (type) {
            case 'success':
                icon.className = 'bi bi-check-circle-fill';
                break;
            case 'error':
                icon.className = 'bi bi-exclamation-circle-fill';
                break;
            case 'warning':
                icon.className = 'bi bi-exclamation-triangle-fill';
                break;
            default:
                icon.className = 'bi bi-info-circle-fill';
        }

        // Create message text
        const text = document.createElement('span');
        text.textContent = message;

        // Create close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this.hide(notification);

        // Assemble notification
        notification.appendChild(icon);
        notification.appendChild(text);
        notification.appendChild(closeBtn);

        // Add to container
        this.container.appendChild(notification);

        // Add show class after a small delay for animation
        setTimeout(() => notification.classList.add('show'), 10);

        // Auto hide after duration
        if (duration > 0) {
            setTimeout(() => this.hide(notification), duration);
        }

        return notification;
    }

    hide(notification) {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300); // Match transition duration
    }

    success(message, duration = 3000) {
        return this.show(message, 'success', duration);
    }

    error(message, duration = 5000) {
        return this.show(message, 'error', duration);
    }

    warning(message, duration = 4000) {
        return this.show(message, 'warning', duration);
    }

    info(message, duration = 3000) {
        return this.show(message, 'info', duration);
    }

    // Show progress notification
    showProgress(message, progress) {
        const notification = this.show(message, 'info', 0);
        
        // Add progress bar if not exists
        let progressBar = notification.querySelector('.notification-progress');
        if (!progressBar) {
            progressBar = document.createElement('div');
            progressBar.className = 'notification-progress';
            notification.appendChild(progressBar);
        }

        // Update progress
        progressBar.style.width = `${progress}%`;
        return notification;
    }
}

// Create global instance
const notificationSystem = new NotificationSystem();

// Export for use in other files
window.notificationSystem = notificationSystem;