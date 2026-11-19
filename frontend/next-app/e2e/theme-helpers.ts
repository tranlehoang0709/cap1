import {expect,type Page} from '@playwright/test';
export const themeButton=(page:Page)=>page.getByRole('button',{name:'Đổi giao diện Sáng/Tối',exact:true});
export async function selectTheme(page:Page,mode:string){const button=themeButton(page);await expect(button).toHaveAttribute('data-hydrated','true');if(await button.getAttribute('data-theme-mode')!==mode)await button.click();await expect(button).toHaveAttribute('data-theme-mode',mode);await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^| )${mode}(?: |$)`));}
