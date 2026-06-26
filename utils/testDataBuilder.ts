type TestUser = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

/**
 * Creates a test user with randomized email to avoid conflicts
 * @returns TestUser object with email, firstName, lastName, and password
 */
export function createTestUser(): TestUser {
  const timestamp = Date.now();
  const randomSuffix = Math.floor(Math.random() * 1000);
  
  return {
    email: `ppv_automation_${timestamp}@yopmail.com`,
    firstName: 'UAT',
    lastName: 'UAT',
    password: process.env.NEW_USER_PASSWORD || 'Test1!',
  };
}

/**
 * Creates a test user with a specific email address
 * @param email - Custom email address
 * @returns TestUser object with specified email
 */
export function createTestUserWithEmail(email: string): TestUser {
  return {
    email,
    firstName: 'UAT',
    lastName: 'UAT',
    password: process.env.NEW_USER_PASSWORD || 'Test1!',
  };
}
