# HSHO Player Admin (Supabase)

หน้าเว็บส่วนตัวสำหรับดู ค้นหา เพิ่ม แก้ไข และลบข้อมูลผู้เล่น หน้าเว็บคุยกับ Express backend; backend เก็บข้อมูลในตาราง Postgres `players` และ `server_settings` บน Supabase Free โดยไม่ใช้ MongoDB และไม่ส่ง secret key ไปยังเบราว์เซอร์

## ตั้งฐานข้อมูล

1. สร้างโปรเจกต์ Supabase Free
2. เปิด **SQL Editor** แล้วรันไฟล์ `schema.sql` หนึ่งครั้ง เพื่อสร้างตารางและสิทธิ์สำหรับ backend
3. ใน Supabase Project Settings / API Keys คัดลอก **Project URL** และ **Secret key** (หรือ service role secret ถ้ามี UI แบบเดิม)
4. ห้ามใช้ publishable/anon key เป็น `SUPABASE_SECRET_KEY` และห้ามส่ง secret key ให้หน้าเว็บหรือ commit ลง GitHub

## Deploy บน Render

1. ใส่ไฟล์ในโฟลเดอร์นี้เข้า repository ที่เชื่อมกับ Render โดยให้ `server.js`, `package.json`, `schema.sql` และ `public/admin.html` อยู่ใต้ Root Directory เดียวกัน
2. เลือก Runtime **Node**, Build Command `npm install`, Start Command `npm start`
3. ตั้ง Environment Variables:

| Key | Value |
| --- | --- |
| `SUPABASE_URL` | Project URL ของ Supabase |
| `SUPABASE_SECRET_KEY` | Secret key สำหรับ backend เท่านั้น |
| `ADMIN_PASSWORD` | รหัสผ่านหน้าแอดมิน |
| `ADMIN_SESSION_SECRET` | สุ่มลับยาวอย่างน้อย 32 ตัวอักษร |
| `STEAM_APP_ID` | `1898080` (มีค่าเริ่มต้นอยู่แล้ว) |
| `STEAM_API_KEY` | ใส่เมื่อ API เดิมต้องใช้; เก็บเป็นความลับ |

`PORT` Render กำหนดให้อัตโนมัติ ไม่ต้องเพิ่มเอง หน้าแอดมินอยู่ที่ `https://<ชื่อบริการ>.onrender.com/admin`

## จัดการ Launcher

แอดมินตั้งเวลาปิดได้ 1–10,080 นาที backend บันทึก `is_online` และ `closed_until` ใน `server_settings`; `/live/checkversion` ส่ง `IsOnline` กับ `ClosedUntil` ให้ Launcher และเปิดสถานะอัตโนมัติเมื่อครบเวลา

## ฟรีและข้อจำกัด

Supabase Free ให้ฐานข้อมูล 500 MB ต่อโปรเจกต์ และอาจพักโปรเจกต์หลังไม่มีการใช้งานหนึ่งสัปดาห์ จึงเหมาะกับการทดลอง/ชุมชนเล็ก โปรดดู [ราคาและโควตาปัจจุบัน](https://supabase.com/pricing) ก่อนใช้งานจริง Render Free พัก web service หลังไม่มี traffic 15 นาที ดังนั้นการเปิดครั้งแรกอาจช้า [ข้อจำกัด Render Free](https://render.com/docs/free)

## ข้อมูลผู้เล่นที่หน้าเว็บรองรับ

- `steam_id` ตัวเลข 17 หลัก, ชื่อ, Level, EXP, Gold และ Gem
- ค้นหาได้และแสดงสูงสุด 100 รายการต่อหน้า
- ปุ่มลบมีหน้าต่างยืนยัน
- หน้าแอดมินมี session cookie แบบ HttpOnly/SameSite, CSRF token และจำกัดการลองรหัสผ่าน

Steam authentication สำหรับ game API เป็นส่วนแยก; อย่าเปิดข้อมูลผู้เล่นให้ client เกมจนกว่าจะเพิ่ม middleware ตรวจ Steam ที่เชื่อถือได้จริง
