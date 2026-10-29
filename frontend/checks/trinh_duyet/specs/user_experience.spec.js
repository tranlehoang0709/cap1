/** UX mẫu có nguồn: không tạo state AI giả, không gửi yêu cầu thiết bị hay AI thật. */
import {test, expect} from '../fixtures/phien_demo.js';
import {navigate, ensureSidebar, dismissOverlaySidebar} from '../helpers/dieu_huong.js';
import {setTheme, assertTheme} from '../helpers/chu_de.js';
import {assertHeader, assertControls, assertOverflow} from '../helpers/bo_cuc.js';
import {robotFrame} from '../helpers/robot.js';
import {preserveIdentity, compareIdentity} from '../helpers/vong_doi_iframe.js';

for (const width of [390, 768, 1024, 1440]) test.describe(`user-experience-${width}`, () => {
  test.use({demoRole:'user', viewport:{width, height:1080}});
  test('Trạng thái mẫu, hướng dẫn ghép nối và lỗi dễ hiểu @user_experience', async ({page}) => {
    test.setTimeout(180000);
    const frame=await robotFrame(page), identity=await preserveIdentity(frame);
    for (const [index,dark] of [false,true].entries()) {
      if (index) await navigate(page,'Dashboard');
      await ensureSidebar(page); await setTheme(page,dark); await dismissOverlaySidebar(page);
      await expect(page.locator('.st-key-robot_status_dashboard')).toContainText('2 đang trực tuyến');
      await expect(page.locator('.st-key-robot_status_dashboard')).toContainText('1 đang ngoại tuyến');
      await expect(page.locator('.st-key-robot_status_dashboard')).toContainText('chưa phản ánh kết nối với thiết bị thật');
      if (!index) {
        expect(await compareIdentity(identity,frame)).toEqual({oldConnected:true,sameElement:true,sameDocument:true,sameCanvas:true,sameDiagnostics:true});
        expect(await frame.evaluate(()=>window.__AIVA3D__.rendererInitializations)).toBe(1);
      }
      await assertTheme(page,dark); await assertHeader(page); await assertOverflow(page);
      await navigate(page,'AI Chat');
      await expect(page.locator('.st-key-robot_status_chat')).toContainText('2 đang trực tuyến');
      const search=page.getByRole('textbox',{name:'Tìm kiếm hội thoại…',exact:true});
      await search.fill('PHASE7_NO_MATCH'); await search.press('Enter');
      await expect(page.getByText('Thử từ khóa ngắn hơn hoặc xóa nội dung ô tìm kiếm.',{exact:true})).toBeVisible();
      await search.fill(''); await search.press('Enter');
      await navigate(page,'Thiết bị của tôi');
      const guide=page.locator('.st-key-pairing_guide');
      await expect(guide).toContainText('Chờ quản trị viên duyệt');
      await expect(guide).toContainText('chưa kết nối với phần cứng');
      const code=page.getByRole('textbox',{name:'Mã ghép nối robot',exact:true});
      const send=page.getByRole('button',{name:'Gửi yêu cầu mẫu',exact:true});
      await code.fill(''); await send.click();
      await expect(page.getByText('Bạn chưa nhập mã. Nhập mã robot rồi gửi lại yêu cầu.',{exact:true})).toBeVisible();
      await code.fill('PHASE7_UNKNOWN'); await send.click();
      await expect(guide).toContainText('Không tìm thấy mã trong dữ liệu mẫu');
      await code.fill('PAIR001'); await send.click();
      await expect(guide).toContainText('đã được liên kết với một tài khoản');
      await code.fill(index?'PAIR003':'PAIR002'); await send.click();
      await expect(guide.getByRole('progressbar')).toHaveAttribute('aria-valuenow','66');
      await expect(guide).toContainText('Đang chờ duyệt');
      await send.click(); await expect(guide).toContainText('Bạn không cần gửi lại');
      await assertControls(page); await assertOverflow(page); await assertTheme(page,dark);
      await ensureSidebar(page); await expect(page.getByTestId('stSidebar').getByRole('radio')).toHaveCount(5);
    }
    await identity.dispose();
  });
});
