# HSHO Player Admin (Supabase)

หน้าเว็บส่วนตัวสำหรับดู ค้นหา เพิ่ม แก้ไข และลบข้อมูลผู้เล่น หน้าเว็บคุยกับ Express backend; backend เก็บข้อมูลในตาราง Postgres `players` และ `server_settings` บน Supabase Free โดยไม่ใช้ MongoDB และไม่ส่ง secret key ไปยังเบราว์เซอร์

## ตั้งฐานข้อมูล

1. สร้างโปรเจกต์ Supabase Free
2. เปิด **SQL Editor** แล้วรันไฟล์ `schema.sql` หนึ่งครั้ง เพื่อสร้างตารางและสิทธิ์สำหรับ backend
3. ใน Supabase Project Settings / API Keys คัดลอก **Project URL** และ **Secret key** (หรือ service role secret ถ้ามี UI แบบเดิม)
4. ห้ามใช้ publishable/anon key เป็น `SUPABASE_SECRET_KEY` และห้ามส่ง secret key ให้หน้าเว็บหรือ commit ลง GitHub


## Hosts Registry สำหรับ HSHONAD Launcher

หน้า Admin เดิมที่ `/admin` จัดการทั้งข้อมูลผู้เล่น/Whitelist และทะเบียน Hosts Registry โดยยังใช้ Supabase project เดียวกัน ทั้งสองส่วนอยู่คนละตารางและ endpoint จึงไม่ต้องแก้ schema ของผู้เล่นเมื่อแก้ทะเบียนโดเมน

- ตาราง `public.host_registry`: เก็บโดเมนที่อนุญาต 4 รายการ, สถานะ, วัตถุประสงค์, หมายเหตุ และเวลาอัปเดต
- ตาราง `public.host_registry_audit`: เก็บสถานะก่อน/หลังการบันทึกสำหรับตรวจสอบย้อนหลัง
- `GET /api/hosts-config`: endpoint อ่านอย่างเดียวสำหรับ Launcher; ส่ง `version`, `updatedAt`, และ `hosts[]`
- `GET /admin/api/hosts`: อ่านทะเบียนในหน้า Admin หลังเข้าสู่ระบบ
- `PUT /admin/api/hosts`: บันทึกทะเบียน ต้องใช้ admin session และ `X-Admin-CSRF`
- `GET /admin/api/hosts/audit`: ประวัติการบันทึกเฉพาะผู้ดูแลระบบ

สำหรับฐานข้อมูลที่ตั้งไว้แล้ว การเพิ่ม schema ใช้ `CREATE TABLE IF NOT EXISTS` และ seed แบบ `ON CONFLICT DO NOTHING` จึงไม่เขียนทับค่าในทะเบียนที่มีอยู่ ใช้ `schema.sql` สำหรับตั้งฐานข้อมูลใหม่หรืออ้างอิง schema ฉบับรวม

**ขอบเขตความปลอดภัย:** ตาราง Registry เปิด RLS และปิดสิทธิ์ `anon` / `authenticated`; เฉพาะ backend ที่ใช้ secret key ฝั่ง server เท่านั้นที่อ่าน/เขียนฐานข้อมูลโดยตรงได้ Endpoint สาธารณะส่งเฉพาะ metadata ของโดเมนที่กำหนดไว้ ไม่ส่ง credential หรือ IP และไม่แก้ไข Windows Hosts / network routing

## Deploy บน Render

1. ใส่ไฟล์ในโฟลเดอร์นี้เข้า repository ที่เชื่อมกับ Render โดยให้ `server.js`, `package.json`, `schema.sql` และ `public/admin.html` อยู่ใต้ Root Directory เดียวกัน
2. เลือก Runtime **Node**, Build Command `npm install`, Start Command `npm start`
3. ตั้ง Environment Variables:

| Key | Value |
| --- | --- |
| `SUPABASE_URL` | Project URL ของ Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role secret สำหรับ backend เท่านั้น (ห้ามเผยแพร่ใน browser) |
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
