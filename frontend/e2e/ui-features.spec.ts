import { test, expect, type Page } from '@playwright/test';

// 화면에 보이는 기능 전체를 데모 모드에서 점검하는 E2E. (합성 데이터만 사용)
const send = async (page: Page, text: string) => {
  await page.getByLabel('메시지', { exact: true }).fill(text);
  await page.getByRole('button', { name: '메시지 보내기' }).click();
};

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('첫 화면: 안내 문구, 빠른 실행 버튼, 빈 입력은 전송 불가', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText('월세랑 전기요금');
  await expect(page.getByRole('button', { name: '월세 등록하기' })).toBeVisible();
  await expect(page.getByRole('link', { name: /한전ON/ }).or(page.getByRole('button', { name: '한전ON 열기' }))).toBeVisible();
  await expect(page.getByRole('button', { name: '메시지 보내기' })).toBeDisabled();
  await page.getByLabel('메시지', { exact: true }).fill('   ');
  await expect(page.getByRole('button', { name: '메시지 보내기' })).toBeDisabled();
});

test('Enter로 전송, Shift+Enter는 줄바꿈', async ({ page }) => {
  const box = page.getByLabel('메시지', { exact: true });
  await box.fill('첫줄');
  await box.press('Shift+Enter');
  await expect(box).toHaveValue('첫줄\n');
  await box.fill('전기요금 알려줘');
  await box.press('Enter');
  await expect(page.getByRole('log', { name: '생활비 대화 내역' })).toContainText('전기요금 알려줘');
  await expect(box).toHaveValue('');
});

test('월세 등록하기 버튼: 누락 항목을 되묻고 확인 후에만 저장, 취소 가능', async ({ page }) => {
  await page.getByRole('button', { name: '월세 등록하기' }).click();
  await expect(page.getByRole('log')).toContainText('월세 일정과 계좌 등록할게');
  await send(page, '월세 45만 원, 매달 8일, 예시은행 000-123-456789, 예금주 김예시로 등록해줘');
  await expect(page.getByRole('button', { name: '확인하고 등록' })).toBeVisible();
  await expect(page.getByRole('button', { name: '취소하기' })).toBeVisible();
  await page.getByRole('button', { name: '취소하기' }).click();
  await expect(page.getByRole('button', { name: '확인하고 등록' })).toBeDisabled();
});

test('송금 안내: 문구 표시·복사 버튼, 복사해도 납부 완료로 바뀌지 않음', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await send(page, '월세 45만 원, 매달 8일, 예시은행 000-123-456789, 예금주 김예시로 등록해줘');
  await page.getByRole('button', { name: '확인하고 등록' }).click();
  await expect(page.getByLabel('송금 안내 문구').first()).toContainText('000-123-456789');
  await page.getByRole('button', { name: '송금정보 복사' }).first().click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('000-123-456789');
  await expect(page.getByText('복사·안내 확인은 납부 완료가 아니에요', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('사용자 확인으로 납부 기록을 남겼어요', { exact: false })).toHaveCount(0);
});

test('클립보드 거부 시 직접 복사 모달과 Escape 닫기', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
  });
  await page.goto('/');
  await send(page, '월세 45만 원, 매달 8일, 예시은행 000-123-456789, 예금주 김예시로 등록해줘');
  await page.getByRole('button', { name: '확인하고 등록' }).click();
  await page.getByRole('button', { name: '송금정보 복사' }).first().click();
  const dlg = page.getByRole('dialog', { name: '송금정보 직접 복사' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('복사할 송금정보')).toHaveValue(/000-123-456789/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('전기요금 샘플 조회: 합성 표시, 공식 한전ON 링크, 납부 기록은 확인 후에만', async ({ page }) => {
  await send(page, '한전 샘플 조회해줘');
  await expect(page.getByText('합성', { exact: false }).first()).toBeVisible();
  const link = page.getByRole('link', { name: /한전ON에서/ }).first();
  await expect(link).toHaveAttribute('href', 'https://online.kepco.co.kr/');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await send(page, '전기요금 납부했어');
  await page.getByRole('button', { name: '납부 기록하기' }).click();
  await expect(page.getByText('사용자 확인으로 납부 기록을 남겼어요', { exact: false })).toBeVisible();
});

test('알림: 동의 전 안내, 동의/끄기 전환, 모달 닫기 버튼', async ({ page }) => {
  await page.getByRole('button', { name: '알림 열기', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await page.getByRole('button', { name: '동의하고 알림 켜기' }).click();
  await expect(page.getByRole('button', { name: '알림 끄기', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '알림 끄기', exact: true }).click();
  await expect(page.getByRole('button', { name: '동의하고 알림 켜기' })).toBeVisible();
  await page.getByRole('button', { name: '닫기' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('대화 중 알림 동의 카드: 나중에 할게요로 숨기기 / 알림 받을게요로 켜기', async ({ page }) => {
  await send(page, '월세 45만 원, 매달 8일, 예시은행 000-123-456789, 예금주 김예시로 등록해줘');
  await page.getByRole('button', { name: '확인하고 등록' }).click();
  const later = page.getByRole('button', { name: '나중에 할게요' });
  if (await later.count()) {
    await later.click();
    await expect(later).toHaveCount(0);
  }
  await page.getByRole('button', { name: '알림 열기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('캘린더: 월 이동, 날짜 선택, 일정 없는 날 문구, 일정 클릭 시 대화로 이동', async ({ page }) => {
  await send(page, '월세 45만 원, 매달 8일, 예시은행 000-123-456789, 예금주 김예시로 등록해줘');
  await page.getByRole('button', { name: '확인하고 등록' }).click();
  await page.getByRole('button', { name: '캘린더 열기', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: '납부 캘린더' });
  await expect(dlg).toBeVisible();
  const title = await dlg.locator('.month-control strong').innerText();
  await dlg.getByRole('button', { name: '다음 달' }).click();
  await expect(dlg.locator('.month-control strong')).not.toHaveText(title);
  await dlg.getByRole('button', { name: '이전 달' }).click();
  await expect(dlg.locator('.month-control strong')).toHaveText(title);
  const day1 = dlg.getByRole('button', { name: /^\d{4}-\d{2}-01 일정$/ });
  await day1.click();
  await expect(day1).toHaveAttribute('aria-pressed', 'true');
  await expect(dlg.getByText('등록된 납부 일정이 없어요.')).toBeVisible();
  await dlg.getByRole('button', { name: /^\d{4}-\d{2}-08 일정$/ }).click();
  await dlg.locator('.calendar-bill').first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('log')).toContainText('알려줘');
});

test('메뉴: 캘린더·알림 이동, 데모 기록 초기화', async ({ page }) => {
  await send(page, '한전 샘플 조회해줘');
  await page.getByRole('button', { name: '메뉴 열기' }).or(page.getByRole('button', { name: '데모 설정' })).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '납부 캘린더' }).last().click();
  await expect(page.getByRole('dialog', { name: '납부 캘린더' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '메뉴 열기' }).or(page.getByRole('button', { name: '데모 설정' })).first().click();
  await page.getByRole('button', { name: '데모 기록 초기화' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('월세랑 전기요금');
});

test('접근성: 모달 포커스 트랩과 닫은 뒤 포커스 복귀, 가로 스크롤 없음', async ({ page }) => {
  const opener = page.getByRole('button', { name: '캘린더 열기', exact: true });
  await opener.click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
  expect(await dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
