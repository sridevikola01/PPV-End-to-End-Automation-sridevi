import { AndroidBasePage, AndroidFlowHooks, WdBrowser, WdElement, adbTap, getScreenSize } from './AndroidBasePage';

export interface AndroidLoginCredentials {
  email?: string;
  password?: string;
  navigateToHomeAfterLogin?: boolean;
}

export class AndroidMyAccountPage extends AndroidBasePage {
  async preLoginFlow(baseUrl: string, credentials: AndroidLoginCredentials = {}): Promise<void> {
    void baseUrl;
    console.log('\nPRE-LOGIN FLOW: Signing in existing user...');
    await this.driver.pause(500);

    // Fresh installs now open directly on the combined Log in / sign up
    // screen.  There is no profile/menu action to take in that case.
    const emailScreen = await this.findEl(
      'android=new UiSelector().className("android.widget.EditText")',
      10000,
    );
    
    // Declare emailInput at function level so it can be used in password section
    let emailInput: any = null;
    let emailNeededFallback = false;

    const directLoginSelectors = [
      // Exact text matches (Android UiSelector is case-sensitive)
      'android=new UiSelector().text("Sign In")',
      'android=new UiSelector().text("Sign in")',
      'android=new UiSelector().text("Log In")',
      'android=new UiSelector().text("Log in")',
      'android=new UiSelector().text("Login")',
      // Exact description matches
      'android=new UiSelector().description("Sign In")',
      'android=new UiSelector().description("Sign in")',
      'android=new UiSelector().description("Log In")',
      'android=new UiSelector().description("Log in")',
      'android=new UiSelector().description("Login")',
      // Contains text matches
      'android=new UiSelector().textContains("Sign In")',
      'android=new UiSelector().textContains("Sign in")',
      'android=new UiSelector().textContains("Log In")',
      'android=new UiSelector().textContains("Log in")',
      'android=new UiSelector().textContains("Login")',
      'android=new UiSelector().descriptionContains("Sign In")',
      'android=new UiSelector().descriptionContains("Sign in")',
      'android=new UiSelector().descriptionContains("Log In")',
      'android=new UiSelector().descriptionContains("Log in")',
      'android=new UiSelector().descriptionContains("Login")',
      // XPath fallback: case-insensitive text match
      '//*[contains(translate(text(), "LOGIN", "login"), "login") or contains(translate(text(), "SIGN IN", "sign in"), "sign in")]',
    ];

    let loginClicked = !!emailScreen;
    for (const selector of emailScreen ? [] : directLoginSelectors) {
      try {
        const loginBtn = await this.driver.$(selector);
        if (await loginBtn.isDisplayed()) {
          console.log(`  Found direct login button with selector: ${selector}, clicking...`);
          await loginBtn.click();
          await this.driver.pause(1500);
          loginClicked = true;
          break;
        }
      } catch {}
    }

    if (!loginClicked) {
      console.log('  Direct login button not found, trying via Profile/Account icon...');
      const profileSelectors = [
        'android=new UiSelector().descriptionContains("Profile")',
        'android=new UiSelector().descriptionContains("Account")',
        'android=new UiSelector().textContains("Profile")',
        'android=new UiSelector().textContains("Account")',
        '//android.widget.ImageView[contains(@content-desc, "Profile")]',
        '//android.widget.ImageView[contains(@content-desc, "Account")]',
      ];

      let profileFound = false;
      for (const selector of profileSelectors) {
        try {
          const profileBtn = await this.driver.$(selector);
          if (await profileBtn.isDisplayed()) {
            console.log('  Found Profile/Account button, tapping...');
            await profileBtn.click();
            await this.driver.pause(800);
            profileFound = true;
            break;
          }
        } catch {}
      }

      if (!profileFound) {
        console.log('  Profile button not found via selectors, trying coordinate tap...');
        const screenSize = getScreenSize();
        adbTap(Math.round(screenSize.width * 0.90), Math.round(screenSize.height * 0.06));
        await this.driver.pause(1000);
      }

      for (const selector of directLoginSelectors) {
        try {
          const signInBtn = await this.driver.$(selector);
          if (await signInBtn.isDisplayed()) {
            console.log('  Found Sign In button in profile menu, tapping...');
            await signInBtn.click();
            await this.driver.pause(1500);
            loginClicked = true;
            break;
          }
        } catch {}
      }
    }

    if (credentials.email) {
      console.log(`  Entering email: ${credentials.email}`);
      const emailSelectors = [
        'android=new UiSelector().className("android.widget.EditText")',
        '//*[@resource-id="EmailAddressField"]',
        'android=new UiSelector().resourceIdMatches(".*(email|username).*")',
        'android=new UiSelector().descriptionContains("Email")',
        'android=new UiSelector().textContains("Email")',
      ];
      for (const selector of emailSelectors) {
        emailInput = await this.findEl(selector, 2500);
        if (emailInput) break;
      }
      if (!emailInput) {
        throw new Error('Login screen opened but no email input was found');
      }

      // Wait for element to be interactable and click it to ensure focus
      await emailInput.waitForDisplayed({ timeout: 5000 });
      await emailInput.click();
      await this.driver.pause(500);
      
      // Clear any existing text and wait for the field to be ready
      await emailInput.clearValue();
      await this.driver.pause(300);
      
      // Set the email value
      await emailInput.setValue(credentials.email);
      const readEmail = async (): Promise<string> => (
        await emailInput.getAttribute('text').catch(() => '') ||
        await emailInput.getText().catch(() => '')
      );
      let enteredEmail = await readEmail();
      if (enteredEmail.toLowerCase() !== credentials.email.toLowerCase()) {
        emailNeededFallback = true;
        // Compose text fields on some Android builds ignore setValue but accept
        // key events. Clear first so this remains safe on a partially-filled UI.
        await emailInput.clearValue();
        await emailInput.click().catch(() => {});
        await this.driver.keys([...credentials.email]);
        enteredEmail = await readEmail();
      }
      if (enteredEmail.toLowerCase() !== credentials.email.toLowerCase()) {
        throw new Error('Email input did not retain the requested credential');
      }
      await this.driver.pause(500);

        const continueSelectors = [
          '//*[@resource-id="GetStartedButton"]',
          'android=new UiSelector().text("Get started")',
          'android=new UiSelector().text("Get Started")',
          'android=new UiSelector().text("Continue")',
          'android=new UiSelector().text("Next")',
          'android=new UiSelector().textContains("Get started")',
          'android=new UiSelector().textContains("Get Started")',
          'android=new UiSelector().textContains("Next")',
        ];

      for (const selector of continueSelectors) {
        try {
          const continueBtn = await this.driver.$(selector);
          if (await continueBtn.isDisplayed()) {
            await continueBtn.click();
            await this.driver.pause(1500);
            break;
          }
        } catch {}
        }
    }

    if (credentials.password) {
      console.log('  Entering password...');
      
      // The sign-in form is rendered asynchronously after the email step. Do
      // not reuse the email element: its reference remains valid even after
      // the password page replaces it, which causes input to be sent nowhere.
      const passwordSelectors = [
        'android=new UiSelector().className("android.widget.EditText").password(true)',
        '//android.widget.EditText[contains(translate(@resource-id, "PASSWORD", "password"), "password")]',
        'android=new UiSelector().className("android.widget.EditText").resourceIdMatches(".*[Pp]assword.*")',
        '//android.widget.EditText[@resource-id="PasswordField"]',
      ];
      let passwordInput: WdElement = null;
      
      for (const selector of passwordSelectors) {
        passwordInput = await this.findEl(selector, 10000);
        if (passwordInput) {
          console.log(`  Found password field by selector: ${selector}`);
          break;
        }
      }
      
      // Some Compose builds omit the Android password flag. In that case the
      // sole visible EditText on the password screen is the safe fallback.
      // Some Compose builds omit the Android password flag. In that case, find all EditText elements
      // and pick the one that is likely the password input (e.g. not displaying the email address).
      if (!passwordInput) {
        const fields = await this.driver.$$('android=new UiSelector().className("android.widget.EditText")');
        console.log(`  Found ${fields.length} EditText fields on password page`);
        for (const field of fields) {
          try {
            if (await field.isDisplayed()) {
              const textVal = (await field.getAttribute('text').catch(() => '') || '').toLowerCase();
              const emailVal = (credentials.email || '').toLowerCase();
              if (!textVal.includes('@') && (emailVal === '' || !textVal.includes(emailVal))) {
                console.log(`  Selecting EditText field as password input (text: "${textVal}")`);
                passwordInput = field;
                break;
              }
            }
          } catch {}
        }
      }
      
      if (!passwordInput) {
        throw new Error('Email was submitted but no password input was found');
      }

      // Wait for element to be interactable (do not click yet to avoid triggering autofill prompts)
      await passwordInput.waitForDisplayed({ timeout: 5000 });

      const readPassword = async (): Promise<string> => (
        await passwordInput.getAttribute('text').catch(() => '') ||
        await passwordInput.getText().catch(() => '')
      );
      const hasBullets = (val: string) => val.includes('•') || val.includes('●') || val.includes('*');
      const isPlaceholderOrEmpty = (val: string) => {
        const cleaned = val.trim().toLowerCase();
        return cleaned === '' || cleaned === 'password' || cleaned === 'enter password' || cleaned === 'enter your password';
      };

      const focusPasswordInput = async () => {
        try {
          const rect = await passwordInput.getRect();
          // Tap on the left side of the input field to prevent hitting the password visibility toggle icon on the right
          const tapX = Math.round(rect.x + 50);
          const tapY = Math.round(rect.y + rect.height / 2);
          console.log(`  Tapping password field at coordinate (${tapX}, ${tapY}) to focus...`);
          await this.driver.performActions([{
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x: tapX, y: tapY },
              { type: 'pointerDown', button: 0 },
              { type: 'pointerUp', button: 0 }
            ]
          }]);
          await this.driver.pause(500);
        } catch (err: any) {
          console.warn(`  Coordinate focus tap failed: ${err.message}. Falling back to native click...`);
          await passwordInput.click().catch(() => {});
        }
      };

      const tryAdbFallback = async () => {
        console.log('  Password input still empty. Trying ADB shell input text fallback...');
        const escaped = credentials.password.replace(/([$"`\\!*?&|()<>#~;])/g, '\\$1');
        try {
          const { execSync } = require('child_process');
          const ANDROID_SDK = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
          const ADB = `${ANDROID_SDK}/platform-tools/adb`;

          // Get the UDID capability from the Appium driver to support multi-device/multi-runner environments
          const caps: any = await this.driver.getCapabilities().catch(() => ({}));
          const udid = caps['appium:udid'] || caps.udid || caps['appium:deviceUDID'] || caps.deviceUDID || process.env.DEVICE_SERIAL || '';
          const serialArg = udid ? `-s ${udid}` : '';

          console.log(`  Executing ADB command on device serial: "${udid || 'default'}"`);
          execSync(`${ADB} ${serialArg} shell input text "${escaped}"`);
          await this.driver.pause(1000);
          console.log('  ADB shell input text fallback executed');
        } catch (adbErr: any) {
          console.warn(`  ADB text input failed: ${adbErr.message}`);
        }
      };

      if (emailNeededFallback) {
        console.log('  Email input required key events fallback. Using driver.keys directly for password...');
        await focusPasswordInput();
        await this.driver.keys([...credentials.password]);

        const enteredPassword = await readPassword();
        if (isPlaceholderOrEmpty(enteredPassword) && !hasBullets(enteredPassword)) {
          await tryAdbFallback();
        }
      } else {
        let setValueSuccess = false;
        try {
          // `setValue` sends text directly to UiAutomator and is reliable for
          // symbols such as @ and !. It also avoids keyboard focus being lost
          // between individual driver.keys calls.
          await passwordInput.setValue(credentials.password);
          setValueSuccess = true;
        } catch (err: any) {
          console.warn(`  setValue failed with error: ${err.message}. Falling back to driver.keys...`);
        }

        let enteredPassword = await readPassword();
        if (!setValueSuccess || (isPlaceholderOrEmpty(enteredPassword) && !hasBullets(enteredPassword))) {
          console.log('  Password input did not retain value from setValue. Falling back to driver.keys...');
          await focusPasswordInput();
          await this.driver.keys([...credentials.password]);

          enteredPassword = await readPassword();
          if (isPlaceholderOrEmpty(enteredPassword) && !hasBullets(enteredPassword)) {
            await tryAdbFallback();
          }
        }
      }
      await this.driver.pause(500);

      if (await this.driver.isKeyboardShown().catch(() => false)) {
        console.log('  Keyboard is visible — hiding keyboard to expose Sign In buttons...');
        await this.driver.hideKeyboard().catch(() => {});
        await this.driver.pause(1000);
      }
 
      const signInSelectors = [
          'android=new UiSelector().text("Sign In")',
          'android=new UiSelector().text("Sign in")',
          'android=new UiSelector().text("Log In")',
          'android=new UiSelector().text("Log in")',
          'android=new UiSelector().textContains("Sign In")',
          'android=new UiSelector().textContains("Sign in")',
          'android=new UiSelector().textContains("Log In")',
          'android=new UiSelector().textContains("Log in")',
        ];

      for (const selector of signInSelectors) {
        try {
          const signInBtnFinal = await this.driver.$(selector);
          if (await signInBtnFinal.isDisplayed()) {
            await signInBtnFinal.click();
            await this.driver.pause(2500);
            break;
          }
        } catch {}
        }
    }

    await this.driver.pause(2000);
    
    // Only navigate to Home if requested (skip for myaccount flow which navigates directly to My Account)
    if (credentials.navigateToHomeAfterLogin !== false) {
      console.log('Ensuring navigation to Home page after login...');
      const homeSelectorsAfterLogin = [
        'android=new UiSelector().text("Home")',
        'android=new UiSelector().descriptionContains("Home")',
        '//android.widget.ImageView[contains(@content-desc, "Home")]',
        '//android.widget.TextView[contains(@text, "Home")]',
      ];

      let homeFound = false;
      for (const selector of homeSelectorsAfterLogin) {
        try {
          const homeEl = await this.driver.$(selector);
          if (await homeEl.isDisplayed()) {
            console.log('  Found Home tab, tapping to navigate home...');
            await homeEl.click();
            await this.driver.pause(2000);
            homeFound = true;
            break;
          }
        } catch {}
      }

      if (!homeFound) {
        console.log('  Home tab not found via selectors, trying coordinate tap...');
        const screenSize = getScreenSize();
        adbTap(Math.round(screenSize.width * 0.125), Math.round(screenSize.height * 0.95));
        await this.driver.pause(2000);
      }
      
      console.log('Post-login navigation to Home completed\n');
    } else {
      console.log('Skipping Home navigation (myaccount flow)\n');
    }
  }

  async navigateToMyAccount(): Promise<void> {
    console.log('Navigating to My Account...');

    const myAccountSelectors = [
      'android=new UiSelector().textContains("My Account")',
      'android=new UiSelector().textContains("Account")',
      'android=new UiSelector().textContains("Profile")',
      '//android.widget.TextView[contains(@text, "My Account")]',
      '//android.widget.TextView[contains(@text, "Account")]',
    ];

    for (const selector of myAccountSelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed()) {
          console.log('  Found My Account, tapping...');
          await el.click();
          await this.driver.pause(3000);
          return;
        }
      } catch {}
    }

    const screenSize = getScreenSize();
    adbTap(Math.round(screenSize.width * 0.90), Math.round(screenSize.height * 0.06));
    await this.driver.pause(2000);

    const myAccountMenu = await this.findEl('android=new UiSelector().textContains("My Account")', 3000);
    if (myAccountMenu) {
      await myAccountMenu.click();
      await this.driver.pause(3000);
    }

    console.log('Navigated to My Account\n');
  }

  async openMyAccountPPVPaywall(hooks: AndroidFlowHooks = {}): Promise<boolean> {
    await this.navigateToMyAccount();
    await this.driver.pause(3000);

    console.log(`Looking for PPV: "${this.ppvName}" in My Account...`);
    let ppvAvailable = false;
    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(this.ppvName, 2000)) {
        console.log(`Found PPV: "${this.ppvName}"`);
        ppvAvailable = true;
        break;
      }
      await this.scrollDown();
      await this.driver.pause(1000);
    }

    if (!ppvAvailable) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_myaccount_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'My Account');
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found in My Account`);
      throw new Error(`PPV "${this.ppvName}" not found in My Account. See test-results/android_myaccount_ppv_not_found.png`);
    }

    hooks.recordAvailability?.(true, undefined, 'My Account');

    const buyNowSelectors = [
      'android=new UiSelector().textContains("Buy now")',
      'android=new UiSelector().textContains("Buy Now")',
      'android=new UiSelector().textContains("Buy")',
      'android=new UiSelector().textContains("Purchase")',
    ];

    for (const selector of buyNowSelectors) {
      const buyBtn = await this.findEl(selector, 2000);
      if (buyBtn) {
        console.log('  Found Buy button, tapping...');
        await buyBtn.click();
        await this.driver.pause(3000);
        return true;
      }
    }

    await this.driver.saveScreenshot('./test-results/myaccount_buy_not_found.png');
    throw new Error(`Could not find Buy button for PPV: "${this.ppvName}" in My Account`);
  }

  async getPPVStatus(ppvName: string): Promise<string> {
    await this.navigateToMyAccount();
    await this.driver.pause(2000);

    // Scroll to find the PPV card
    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(ppvName, 2000)) break;
      await this.scrollDown();
      await this.driver.pause(800);
    }

    // Check for Purchased / Included status first
    const statusSelectors = [
      'android=new UiSelector().textContains("Purchased")',
      'android=new UiSelector().textContains("Included")',
      'android=new UiSelector().textContains("Owned")',
    ];
    for (const selector of statusSelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed()) {
          const text = await el.getText();
          if (text) return text.trim();
        }
      } catch {}
    }

    // Check for Buy button (not purchased)
    const buySelectors = [
      'android=new UiSelector().textContains("Buy now")',
      'android=new UiSelector().textContains("Buy Now")',
      'android=new UiSelector().textContains("Buy")',
      'android=new UiSelector().textContains("Purchase")',
    ];
    for (const selector of buySelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed()) {
          return 'Available';
        }
      } catch {}
    }

    return 'Unknown';
  }

  async hasPPVImage(ppvName: string): Promise<boolean> {
    await this.navigateToMyAccount();
    await this.driver.pause(2000);

    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(ppvName, 2000)) break;
      await this.scrollDown();
      await this.driver.pause(800);
    }

    // Look for image near the PPV card (ImageView)
    const imageSelectors = [
      '//android.widget.ImageView',
      '//android.widget.ImageButton',
      '//*[contains(@class, "ImageView")]',
    ];
    for (const selector of imageSelectors) {
      try {
        const els = await this.driver.$(selector);
        if (await els.isDisplayed()) return true;
      } catch {}
    }
    return false;
  }

  async getPPVName(ppvName: string): Promise<string> {
    await this.navigateToMyAccount();
    await this.driver.pause(2000);

    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(ppvName, 2000)) break;
      await this.scrollDown();
      await this.driver.pause(800);
    }

    try {
      const el = await this.driver.$(`android=new UiSelector().textContains("${ppvName}")`);
      if (await el.isDisplayed()) {
        return (await el.getText())?.trim() || ppvName;
      }
    } catch {}

    // Fallback: look for any TextView near the top of the PPV card
    try {
      const cardText = await this.driver.$('//android.widget.TextView');
      if (await cardText.isDisplayed()) {
        return (await cardText.getText())?.trim() || ppvName;
      }
    } catch {}

    return ppvName;
  }

  async getPPVDate(ppvName: string): Promise<string> {
    await this.navigateToMyAccount();
    await this.driver.pause(2000);

    for (let i = 0; i < 10; i++) {
      if (await this.isVisible(ppvName, 2000)) break;
      await this.scrollDown();
      await this.driver.pause(800);
    }

    // Look for date patterns in any TextView (e.g. "Sat 12 Jul", "12 Jul 2026", "HH:MM")
    try {
      const textViews = await this.driver.$$('//android.widget.TextView');
      const allTexts: string[] = [];
      for (const tv of textViews) {
        try {
          const text = await tv.getText();
          if (text && text.trim()) allTexts.push(text.trim());
        } catch {}
      }

      // Match common date/time patterns
      const dateRe = /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i;
      const timeRe = /(\d{1,2}:\d{2}(\s*[aApP][mM])?)/;
      const dateMatch = allTexts.find(t => dateRe.test(t));
      if (dateMatch) return dateMatch;

      const timeMatch = allTexts.find(t => timeRe.test(t));
      if (timeMatch) return timeMatch;
    } catch {}

    return 'N/A';
  }
}

export async function preLoginFlow(
  driver: WdBrowser,
  baseUrl: string,
  credentials: AndroidLoginCredentials,
): Promise<void> {
  return new AndroidMyAccountPage(driver).preLoginFlow(baseUrl, credentials);
}

export async function navigateToMyAccount(driver: WdBrowser): Promise<void> {
  return new AndroidMyAccountPage(driver).navigateToMyAccount();
}

export async function openMyAccountPPVPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidMyAccountPage(driver, ppvName).openMyAccountPPVPaywall(hooks);
}
