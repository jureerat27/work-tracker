// ===== ตั้งค่าระบบ =====
// 1) วางค่าจาก Firebase Console → Project settings → Your apps → Web app (firebaseConfig)
export const firebaseConfig = {
  apiKey: "AIzaSyDV3IcYK-y5b43qweRS59C3jklqub__Mx4",
  authDomain: "work-tracker-614b3.firebaseapp.com",
  projectId: "work-tracker-614b3",
  storageBucket: "work-tracker-614b3.firebasestorage.app",
  messagingSenderId: "1050034562383",
  appId: "1:1050034562383:web:ac02bff0c0b2ddaf6b113a"
};

// (ผู้ดูแลหลักกำหนดไว้ในกฎความปลอดภัยของ Firebase จึงไม่ต้องใส่อีเมลในไฟล์นี้)

// 2) ชื่อระบบ ระดับความสำคัญ และขั้นตอน
//    ถ้าแก้ระดับความสำคัญหรือขั้นตอน ต้องแก้ใน firestore.rules ให้ตรงกันด้วย
export const APP = {
  name: "ระบบติดตามงานค้าง",
  priorities: ["ด่วนมาก", "สำคัญ", "ปกติ"],
  steps: ["ยังไม่ดำเนินการ", "กำลังดำเนินการ", "รอตรวจ/รออนุมัติ", "เสร็จสิ้น"],
  doneStep: "เสร็จสิ้น"
};
