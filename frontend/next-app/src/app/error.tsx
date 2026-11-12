'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: {
    error: Error;
    reset: () => void;
}) { return <main className="error-page"><h1>Chưa thể mở trang</h1><p>Kiểm tra kết nối Backend rồi tải lại. Không có thao tác nào được tự động gửi lại.</p><Button onClick={reset}>Thử tải lại</Button><Link href="/login">Đăng nhập lại</Link></main>; }
