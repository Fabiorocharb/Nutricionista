const { test, expect } = require('@playwright/test');

const pages = ['index.html', 'index2.html', 'index3.html', 'index4.html'];
const widths = [320, 360, 375, 480, 640, 641, 768, 880, 881, 950, 1024, 1280, 1440, 1920];

for (const path of pages) {
  test(`${path}: responsive layout and assets`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`);
    });
    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 640 ? 360 : 900 });
      await page.goto(path);
      await page.evaluate(async () => {
        document.querySelectorAll('img').forEach(img => { img.loading = 'eager'; });
        await Promise.all([...document.images].map(img => img.decode()));
        await document.fonts.ready;
      });
      const problems = await page.evaluate(() => {
        const issues = [];
        const viewport = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > viewport) issues.push('horizontal overflow');
        for (const element of document.querySelectorAll('img, h1, h2, p, li, figcaption, a:not(.skip-link)')) {
          const rect = element.getBoundingClientRect();
          if (rect.left < -1 || rect.right > viewport + 1) issues.push(`outside viewport: ${element.outerHTML.slice(0, 100)}`);
          if (rect.width === 0 || rect.height === 0) issues.push(`hidden content: ${element.tagName}`);
        }
        const overlaps = (a, b) => {
          const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
          return x.left < y.right - 1 && x.right > y.left + 1 && x.top < y.bottom - 1 && x.bottom > y.top + 1;
        };
        for (const selector of ['body', '.intro', '.cards', '.testimonial-images', '.footer-intro', '.detail-grid', '.header-inner', 'nav ul']) {
          const parent = document.querySelector(selector);
          if (!parent) continue;
          const children = [...parent.children].filter(el => !el.matches('.skip-link, script'));
          for (let i = 0; i < children.length; i++) {
            for (let j = i + 1; j < children.length; j++) {
              if (overlaps(children[i], children[j])) issues.push(`overlap in ${selector}`);
            }
          }
        }
        return issues;
      });
      expect(problems, `${path} at ${width}px`).toEqual([]);
      await expect(page.locator('h1')).toHaveCount(1);
      if ([375, 768, 1440].includes(width)) {
        await page.screenshot({ path: testInfo.outputPath(`${width}.png`), fullPage: true });
      }
    }
    // Enlarged text must remain readable without horizontal scrolling.
    await page.setViewportSize({ width: 320, height: 900 });
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('navigation, keyboard access and local links', async ({ page, request }) => {
  for (const path of pages) {
    await page.goto(path);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#conteudo$/);
    const links = await page.locator('a, link[rel="icon"]').evaluateAll(elements => elements.map(el => el.href));
    for (const href of links.filter(href => href.startsWith('http://127.0.0.1:4173'))) {
      const response = await request.get(href);
      expect(response.ok(), href).toBe(true);
      const url = new URL(href);
      if (url.hash) {
        const html = await response.text();
        expect(html).toContain(`id="${url.hash.slice(1)}"`);
      }
    }
    await expect(page.locator('a[href^="https://api.whatsapp.com/"]').first()).toBeVisible();
  }
  await page.goto('index.html');
  for (let i = 2; i <= 4; i++) {
    await page.locator(`.card a[href="./index${i}.html"]`).click();
    await expect(page).toHaveURL(new RegExp(`index${i}\\.html$`));
    await page.getByRole('link', { name: '← Voltar ao público-alvo' }).click();
    await expect(page).toHaveURL(/index\.html#publicoalvo$/);
  }
});
