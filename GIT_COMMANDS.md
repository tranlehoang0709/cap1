# Lệnh Git cơ bản

## Đẩy code nhanh trong CMD

```cmd
cd E:\learn\AI_Project\cap1
git status
git diff
git add AI_SERVER
git add BE
git add frontend
git add xiaozhi-esp32
git add GIT_COMMANDS.md
git commit -m "mo ta thay doi"
git push
```

Thay các thư mục ở trên bằng file hoặc thư mục bạn thực sự đã sửa. Dùng
`git status` lần cuối trước `git commit` để kiểm tra không đưa nhầm file vào Git.

Chạy các lệnh dưới đây trong **Windows CMD** tại thư mục gốc `cap1` để quản lý
cùng lúc các thư mục `AI_SERVER`, `BE`, `frontend` và `xiaozhi-esp32`.

## 1. Xem thay đổi

```cmd
git status
git diff
git diff --staged
git log --oneline -10
```

- `git status`: file đã sửa, thêm, xóa và đang stage.
- `git diff`: nội dung chưa stage.
- `git diff --staged`: nội dung đã stage.
- `git log --oneline -10`: 10 commit gần nhất.

## 2. Thêm, commit và đẩy code

Thêm một file hoặc thư mục cụ thể trước:

```cmd
git add AI_SERVER/app/main.py
git add AI_SERVER
git status
git commit -m "feat(ai-server): them profile thiet bi"
git push
```

Thêm toàn bộ thay đổi đang có trong repository:

```cmd
git add -A
git commit -m "mo ta thay doi"
git push
```

Kiểm tra nhánh và remote trước khi đẩy lần đầu:

```cmd
git branch --show-current
git remote -v
git push -u origin ten-nhanh
```

## 3. Bỏ stage

Lệnh này giữ nguyên nội dung file, chỉ bỏ file khỏi vùng chuẩn bị commit:

```cmd
git restore --staged AI_SERVER/app/main.py
git restore --staged .
```

## 4. Bỏ thay đổi chưa commit

Khôi phục một file về phiên bản của commit gần nhất:

```cmd
git restore AI_SERVER/app/main.py
```

Khôi phục toàn bộ thay đổi chưa commit:

```cmd
git restore .
```

Hai lệnh trên xóa nội dung chỉnh sửa chưa commit. Xem `git diff` trước khi chạy.

## 5. Xóa file bằng Git

Xóa file cả trên máy và trong commit kế tiếp:

```cmd
git rm AI_SERVER/duong-dan/file.py
git commit -m "chore: xoa file cu"
git push
```

Ngừng theo dõi file nhưng vẫn giữ file trên máy:

```cmd
git rm --cached AI_SERVER/.env
echo AI_SERVER/.env>>.gitignore
git add .gitignore
git commit -m "chore: bo theo doi env local"
git push
```

## 6. Hoàn tác thay đổi gần nhất

Hoàn tác commit gần nhất bằng một commit mới. Đây là lựa chọn phù hợp khi commit
đã được đẩy lên remote:

```cmd
git revert HEAD
git push
```

Bỏ commit gần nhất nhưng giữ toàn bộ thay đổi trong vùng stage:

```cmd
git reset --soft HEAD~1
```

Bỏ commit gần nhất, giữ thay đổi trong thư mục làm việc nhưng bỏ stage:

```cmd
git reset HEAD~1
```

Xóa commit gần nhất và toàn bộ thay đổi trong commit đó:

```cmd
git reset --hard HEAD~1
```

`git reset --hard` làm mất thay đổi cục bộ. Không dùng sau khi đã đẩy commit
trừ khi đã thống nhất cách xử lý nhánh với nhóm.

## 7. Sửa commit gần nhất

Thêm file còn thiếu vào commit gần nhất, khi commit chưa được đẩy:

```cmd
git add AI_SERVER/app/main.py
git commit --amend --no-edit
```

Đổi nội dung commit gần nhất:

```cmd
git commit --amend
```

Nếu commit đã được đẩy, ưu tiên `git revert HEAD` thay vì amend rồi force push.

## 8. Cập nhật code từ remote

```cmd
git pull --ff-only
```

`--ff-only` chỉ cập nhật khi không cần tạo merge commit. Nếu có thay đổi cục bộ,
hãy commit hoặc stash trước:

```cmd
git stash push -m "tam luu thay doi"
git pull --ff-only
git stash pop
```
