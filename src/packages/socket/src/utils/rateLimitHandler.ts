import toast from "react-hot-toast";

// Track recent rate limit messages to prevent duplicates
const recentRateLimitMessages = new Set<string>();
const RATE_LIMIT_DEBOUNCE_MS = 2000; // 2 seconds

export const handleRateLimitError = (
  error: string | { error: string; message?: string; retryAfterMs?: number; currentScore?: number; maxScore?: number },
  context: string = "operation"
) => {
  if (typeof error === 'object' && error.error === 'rate_limited' && error.message) {
    const messageKey = `${context}-${error.message}`;
    
    if (recentRateLimitMessages.has(messageKey)) {
      return;
    }
    
    // Add to recent messages and set up cleanup
    recentRateLimitMessages.add(messageKey);
    setTimeout(() => {
      recentRateLimitMessages.delete(messageKey);
    }, RATE_LIMIT_DEBOUNCE_MS);
    
    // Format the message with proper time display
    let displayMessage = error.message;
    
    // If retryAfterMs is provided and > 0, add time information
    if (error.retryAfterMs && error.retryAfterMs > 0) {
      const seconds = Math.ceil(error.retryAfterMs / 1000);
      if (seconds > 1) {
        displayMessage += ` Please wait ${seconds} seconds before trying again.`;
      } else {
        displayMessage += ` Please wait a moment before trying again.`;
      }
    }
    
    toast.error(displayMessage);
    return;
  }
  
  // Handle other errors
  const errorMessage = typeof error === 'string' ? error : error.error || `Unknown ${context} error`;
  toast.error(`${context} error: ${errorMessage}`);
};
