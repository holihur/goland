import { chromium } from '@playwright/test';
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1400,height:900}});
await page.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded',timeout:60000});
await page.getByRole('button',{name:/Sign in/}).click();await page.getByText('New workspace',{exact:true}).waitFor({timeout:30000});
await page.getByText('demo',{exact:true}).first().click();await page.waitForTimeout(500);
await page.getByText('web',{exact:true}).first().click();await page.waitForTimeout(300);await page.getByText('app.ts',{exact:true}).last().click();await page.waitForTimeout(1000);
await page.locator('.cm-line').nth(3).click();await page.keyboard.press('F9');await page.keyboard.press('F5');await page.waitForTimeout(500);await page.getByRole('button',{name:'browser',exact:true}).click();await page.locator('#debug-url').fill('http://127.0.0.1:8099/index.html');await page.getByRole('button',{name:/Start debugging/}).click();
await page.waitForTimeout(25000);const body=await page.locator('body').innerText();console.log('callstack',body.includes('Call stack'),'vars',body.includes('Variables'));console.log(body.slice(body.indexOf('RUN & DEBUG'),body.indexOf('RUN & DEBUG')+1200));
await browser.close();
