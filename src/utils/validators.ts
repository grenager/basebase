// Helper function to validate email format
export function validateEmail(email: string): void {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error("Invalid email format");
  }
}

// Helper function to validate phone number is in E.164 format
export function validatePhone(phone: string): void {
  // Basic validation for E.164 format
  if (!/^\+\d{11,15}$/.test(phone)) {
    throw new Error(
      "Invalid phone number format. Please use E.164 format (e.g., +12345678901)."
    );
  }
}
