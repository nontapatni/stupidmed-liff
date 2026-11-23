// สร้าง payload PromptPay (EMVCo) สำหรับทำ QR — เบอร์มือถือ 10 หลัก / เลขบัตร ปชช. 13 หลัก / e-Wallet 15 หลัก
(function (root) {
  function f(id, v) { return id + String(v.length).padStart(2, '0') + v; }
  function crc16(s) {
    let crc = 0xFFFF;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function payload(target, amount) {
    const t = String(target).replace(/\D/g, '');
    let acc;
    if (t.length >= 15) acc = f('03', t);
    else if (t.length >= 13) acc = f('02', t);
    else acc = f('01', ('0000000000000' + t.replace(/^0/, '66')).slice(-13));
    const amt = Number(amount) > 0;
    let s = f('00', '01') + f('01', amt ? '12' : '11') + f('29', f('00', 'A000000677010111') + acc) + f('58', 'TH') + f('53', '764');
    if (amt) s += f('54', Number(amount).toFixed(2));
    s += '6304';
    return s + crc16(s);
  }
  root.PromptPay = { payload };
})(typeof window !== 'undefined' ? window : globalThis);
