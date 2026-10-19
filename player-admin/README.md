# HSHO Player Admin

หน้าเว็บส่วนตัวสำหรับดู ค้นหา เพิ่ม แก้ไข และลบเอกสารใน MongoDB collection `players` ของโปรเจกต์เซิร์ฟเวอร์ที่ได้รับมา หน้านี้ให้บริการจาก Express ตัวเดียวกับ API เดิม และไม่ส่ง `MONGO_URI` ไปยังเบราว์เซอร์

## รันในเครื่อง

1. ติดตั้ง Node.js รุ่น 18 ขึ้นไป
2. เปิดโฟลเดอร์โปรเจกต์นี้ใน Terminal แล้วรัน `npm install`
3. คัดลอก `.env.example` เป็น `.env` และกรอกค่า MongoDB ของตัวเอง
4. ตั้ง `ADMIN_PASSWORD` เป็นรหัสผ่านส่วนตัว และ `ADMIN_SESSION_SECRET` เป็นค่าสุ่มยาวอย่างน้อย 32 ตัวอักษร
5. รัน `npm start` แล้วเปิด `http://localhost:3000/admin`

ห้ามอัปโหลด `.env` ขึ้น GitHub หรือส่งให้ผู้อื่น

## Deploy ฟรีบน Render

1. อัปโหลดไฟล์โปรเจกต์นี้ไปยัง repository ส่วนตัว โดยไม่ใส่ `.env`, `node_modules`, หรือข้อมูลผู้เล่นจริง
2. สร้าง Render Web Service จาก repository เลือก Runtime เป็น Node และ Build Command `npm install` / Start Command `npm start`
3. ในหน้า Environment ของ Render ใส่ `MONGO_URI`, `MONGO_DB_NAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` และค่าที่จำเป็นจากระบบเดิม (`STEAM_APP_ID`, `STEAM_API_KEY`)
4. กด deploy แล้วเปิด `https://<ชื่อบริการ>.onrender.com/admin`

Render free service อาจพักเมื่อไม่มีการใช้งาน ทำให้เปิดครั้งแรกหลังพักใช้เวลาตื่นระบบ และไฟล์ในเครื่องบริการไม่ใช่พื้นที่เก็บข้อมูลถาวร ข้อมูลผู้เล่นจึงอยู่ใน MongoDB เท่านั้น ส่วน Atlas Free มีโควตาและขนาดจำกัด เหมาะกับงานทดลอง/ชุมชนเล็ก ตรวจสอบโควตาปัจจุบันก่อนใช้งานจริง

## หน้าที่มีให้

- เข้าด้วยรหัสผ่านผู้ดูแลจาก environment
- เปิด/ปิดค่า `IsOnline` ที่ API `/live/checkversion` ส่งให้เกม พร้อมกำหนดเวลาปิดเป็นนาที (1–10,080)
- เมื่อครบเวลาปิด backend จะเปิดสถานะให้อัตโนมัติ; Launcher แสดงเวลาคงเหลือและกลับหน้าเดิมเมื่อเซิร์ฟเวอร์เปิด
- ค้นหาด้วย SteamID หรือชื่อ และแสดงสูงสุด 100 คนต่อครั้ง
- เพิ่ม/แก้ไขชื่อ เลเวล EXP Gold และ Gem
- ลบผู้เล่นโดยมีหน้าต่างยืนยัน
- session cookie แบบ HttpOnly, SameSite และ CSRF token

## ข้อจำกัด

- SteamID ต้องเป็นตัวเลข 17 หลักตาม schema ที่มากับเซิร์ฟเวอร์
- หน้าแอดมินจัดการเฉพาะฟิลด์ `steamId`, `displayName`, `level`, `experience`, `currency.gold`, `currency.gem`; ไม่แก้เอกสารเกมหรือข้อมูล cosmetic ที่อยู่นอก schema นี้
- ปุ่มสถานะเปลี่ยนเฉพาะค่า `IsOnline` ใน `serverinfo` ไม่ได้หยุด/เริ่ม Render service หรือโปรเซส Launcher บนเครื่องผู้เล่น; ฝั่ง Launcher/เกมต้องตรวจค่านี้ด้วยจึงจะบล็อกการเข้าได้
- หน้าแอดมินนี้ไม่ทำ matchmaking หรือยืนยันตัวตน Steam ให้ API เกม
