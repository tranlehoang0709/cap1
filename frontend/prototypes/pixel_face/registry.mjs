// Registry độc lập; không thay đổi preset excited của robot 3D.
export const EXPRESSIONS = Object.freeze({
  neutral: Object.freeze({label:'Bình thường', subtitle:'Nhẹ nhàng, tò mò', blinkMin:2.7, blinkMax:5.8, blinkDuration:0.19, tempo:1.3}),
  happy: Object.freeze({label:'Vui vẻ', subtitle:'Một chút tinh nghịch', blinkMin:2, blinkMax:4.4, blinkDuration:0.16, tempo:2.2}),
  angry: Object.freeze({label:'Tức giận', subtitle:'Dỗi một chút thôi', blinkMin:3.1, blinkMax:5.4, blinkDuration:0.14, tempo:1.8}),
  sad: Object.freeze({label:'Buồn bã', subtitle:'Chậm lại một nhịp', blinkMin:3.8, blinkMax:6.8, blinkDuration:0.28, tempo:0.7}),
  sleepy: Object.freeze({label:'Buồn ngủ', subtitle:'Đến giờ nghỉ ngơi', blinkMin:4.5, blinkMax:7.5, blinkDuration:0.85, tempo:0.55}),
});

export const EXPRESSION_IDS = Object.freeze(Object.keys(EXPRESSIONS));
