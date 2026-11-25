/* A second language on the menu (v2.18).

   An event can carry one menu language besides English (events.menu_lang,
   e.g. 'gu'). Guests and captains then see every dish in English with the
   event's language right under it - always both, nobody has to choose.
   KOTs, kitchen screens and the desk stay English.

   Where the words live (all optional, nothing breaks without them):
     menu_items.i18n       { gu: { name, description }, hi: { ... } }
     menu_categories.i18n  { gu: { name } }
     events.i18n           { gu: { courses: { "Soup": "સૂપ" } } }
   A dish keeps every language it has been given, so the same dish can show
   Gujarati at one event and Hindi at the next.

   Adding a language: one line in LANGS (and, for its buttons, a column in
   PHRASES). Indian scripts, Arabic/Urdu and Thai use the fonts bundled in
   src/lib/langFonts.css; Chinese, Japanese and Korean use the tablet's own. */

// code: the key in the i18n columns (BCP 47, also put on the text as lang=)
// font: the bundled family for the script, if any
export const LANGS = [
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', font: 'SS Gujarati' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', font: 'SS Devanagari' },
  { code: 'mr', name: 'Marathi', native: 'मराठी', font: 'SS Devanagari' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', font: 'SS Tamil' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', font: 'SS Telugu' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ', font: 'SS Kannada' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', font: 'SS Malayalam' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', font: 'SS Bengali' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ', font: 'SS Gurmukhi' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ', font: 'SS Odia' },
  { code: 'ur', name: 'Urdu', native: 'اردو', font: 'SS Arabic', rtl: true },
  { code: 'ar', name: 'Arabic', native: 'العربية', font: 'SS Arabic', rtl: true },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', native: '简体中文',
    system: ['Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei'] },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文',
    system: ['Noto Sans TC', 'Noto Sans CJK TC', 'PingFang TC', 'Microsoft JhengHei'] },
  { code: 'ja', name: 'Japanese', native: '日本語',
    system: ['Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Sans', 'Yu Gothic', 'Meiryo'] },
  { code: 'ko', name: 'Korean', native: '한국어',
    system: ['Noto Sans KR', 'Noto Sans CJK KR', 'Apple SD Gothic Neo', 'Malgun Gothic'] },
  { code: 'th', name: 'Thai', native: 'ไทย', font: 'SS Thai' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
]

const BY_CODE = new Map(LANGS.map(l => [l.code.toLowerCase(), l]))
// a few other spellings people (or older rows) may use for the same language
const ALIAS = { zh: 'zh-Hans', 'zh-cn': 'zh-Hans', 'zh-sg': 'zh-Hans', 'zh-tw': 'zh-Hant', 'zh-hk': 'zh-Hant', jp: 'ja', kr: 'ko' }

/* The language record for a code, or null (English only) */
export function langInfo(code) {
  const c = String(code || '').trim().toLowerCase()
  if (!c || c === 'en') return null
  return BY_CODE.get(c) || BY_CODE.get(String(ALIAS[c] || '').toLowerCase()) || null
}

/* The event's menu language, or null */
export const eventLang = eventData => langInfo(eventData?.menu_lang)

/* CSS font-family for text in this language */
export function fontFor(info) {
  const l = typeof info === 'string' ? langInfo(info) : info
  const q = n => "'" + n + "'"
  const own = l?.font ? [q(l.font)] : (l?.system || []).map(q)
  return [...own, 'Manrope', 'system-ui', 'sans-serif'].join(', ')
}

const clean = v => (typeof v === 'string' ? v.trim() : '')

/* A row's text in a language: dish name / description, category name */
export function localOf(row, code, field = 'name') {
  if (!row || !code) return ''
  const t = row.i18n && typeof row.i18n === 'object' ? row.i18n[code] : null
  return t && typeof t === 'object' ? clean(t[field]) : ''
}

/* A course's name in a language (events.i18n[code].courses, by course name) */
export function courseLocal(eventData, course, code) {
  const map = eventData?.i18n?.[code]?.courses
  if (!map || typeof map !== 'object' || !course) return ''
  const k = String(course).trim().toLowerCase()
  const key = Object.keys(map).find(x => x.trim().toLowerCase() === k)
  return key ? clean(map[key]) : ''
}

/* i18n with one language's fields set (empty values removed). Keeps every
   other language as it was. Returns null when nothing is left. */
export function withLocal(i18n, code, fields) {
  const all = i18n && typeof i18n === 'object' ? { ...i18n } : {}
  const mine = { ...(all[code] && typeof all[code] === 'object' ? all[code] : {}) }
  for (const [k, v] of Object.entries(fields)) {
    const s = clean(v)
    if (s) mine[k] = s
    else delete mine[k]
  }
  if (Object.keys(mine).length) all[code] = mine
  else delete all[code]
  return Object.keys(all).length ? all : null
}

/* events.i18n with one course name set or cleared for a language */
export function withCourseLocal(i18n, code, course, local) {
  const all = i18n && typeof i18n === 'object' ? { ...i18n } : {}
  const mine = { ...(all[code] || {}) }
  const courses = { ...(mine.courses || {}) }
  const k = Object.keys(courses).find(x => x.trim().toLowerCase() === String(course).trim().toLowerCase())
  if (k) delete courses[k]
  if (clean(local)) courses[String(course).trim()] = clean(local)
  if (Object.keys(courses).length) mine.courses = courses
  else delete mine.courses
  if (Object.keys(mine).length) all[code] = mine
  else delete all[code]
  return Object.keys(all).length ? all : null
}

/* A course renamed in Control: its local name follows it */
export function renameCourseLocal(i18n, oldName, newName) {
  if (!i18n || typeof i18n !== 'object') return i18n || null
  const all = { ...i18n }
  let changed = false
  for (const code of Object.keys(all)) {
    const courses = all[code]?.courses
    if (!courses) continue
    const k = Object.keys(courses).find(x => x.trim().toLowerCase() === String(oldName).trim().toLowerCase())
    if (!k) continue
    const v = courses[k]
    const next = { ...courses }
    delete next[k]
    next[String(newName).trim()] = v
    all[code] = { ...all[code], courses: next }
    changed = true
  }
  return changed ? all : i18n
}

/* A header in a menu sheet that names a language: "Dish (Gujarati)",
   "Gujarati name", "ગુજરાતી", "Description - Hindi" -> the language. "Local"
   / "Translation" / "Regional" -> 'local' (the event's language). */
export function langInHeader(header) {
  const h = String(header || '').toLowerCase()
  if (!h.trim()) return null
  for (const l of LANGS) {
    const words = [l.name.toLowerCase(), l.native.toLowerCase(), l.name.toLowerCase().replace(/\s*\(.*\)$/, '')]
    if (l.code === 'zh-Hans') words.push('chinese', 'mandarin', '中文')
    if (l.code === 'or') words.push('oriya')
    if (words.some(w => w && (w.length > 3 ? h.includes(w) : new RegExp('\\b' + w + '\\b').test(h)))) {
      // "Chinese (Traditional)" and "Chinese" both contain "chinese": the more exact one wins
      if (l.code === 'zh-Hans' && /tradition|繁/.test(h)) return 'zh-Hant'
      return l.code
    }
  }
  if (/\b(local|translation|translated|regional|second language)\b/.test(h)) return 'local'
  return null
}

/* ------------------------------------------------------------------ buttons
   Fixed words on the guest screens, by English text. A language without a
   column here still shows its dish names; its buttons stay English until the
   column is added. Phrases are short on purpose: they sit under English on
   a button. Checked by a native speaker before an event in that language. */
const COLS = ['gu', 'hi', 'mr', 'ta', 'te', 'kn', 'ml', 'bn', 'pa', 'ur', 'ar', 'zh-Hans', 'zh-Hant', 'ja', 'ko']
const ROWS = {
  'Start': ['શરૂ કરો', 'शुरू करें', 'सुरू करा', 'தொடங்கு', 'ప్రారంభించండి', 'ಪ್ರಾರಂಭಿಸಿ', 'ആരംഭിക്കുക', 'শুরু করুন', 'ਸ਼ੁਰੂ ਕਰੋ', 'شروع کریں', 'ابدأ', '开始', '開始', 'スタート', '시작'],
  'History': ['ઇતિહાસ', 'इतिहास', 'इतिहास', 'முந்தைய ஆர்டர்', 'చరిత్ర', 'ಇತಿಹಾಸ', 'ചരിത്രം', 'ইতিহাস', 'ਇਤਿਹਾਸ', 'پچھلے آرڈر', 'الطلبات السابقة', '历史订单', '歷史訂單', '注文履歴', '주문 내역'],
  'Help': ['મદદ', 'मदद', 'मदत', 'உதவி', 'సహాయం', 'ಸಹಾಯ', 'സഹായം', 'সাহায্য', 'ਮਦਦ', 'مدد', 'مساعدة', '帮助', '幫助', 'ヘルプ', '도움'],
  'Feedback': ['પ્રતિસાદ', 'प्रतिक्रिया', 'अभिप्राय', 'கருத்து', 'అభిప్రాయం', 'ಪ್ರತಿಕ್ರಿಯೆ', 'അഭിപ്രായം', 'মতামত', 'ਫੀਡਬੈਕ', 'رائے', 'رأيك', '反馈', '意見回饋', 'ご意見', '의견'],
  'Contact us': ['સંપર્ક કરો', 'संपर्क करें', 'संपर्क करा', 'தொடர்புக்கு', 'సంప్రదించండి', 'ಸಂಪರ್ಕಿಸಿ', 'ബന്ധപ്പെടുക', 'যোগাযোগ', 'ਸੰਪਰਕ ਕਰੋ', 'رابطہ کریں', 'اتصل بنا', '联系我们', '聯絡我們', 'お問い合わせ', '문의하기'],
  'Search dishes': ['વાનગી શોધો', 'व्यंजन खोजें', 'पदार्थ शोधा', 'உணவைத் தேடு', 'వంటకం వెతకండి', 'ಖಾದ್ಯ ಹುಡುಕಿ', 'വിഭവം തിരയുക', 'খাবার খুঁজুন', 'ਪਕਵਾਨ ਲੱਭੋ', 'کھانا تلاش کریں', 'ابحث عن طبق', '搜索菜品', '搜尋菜品', '料理を検索', '요리 검색'],
  'Course': ['કોર્સ', 'कोर्स', 'कोर्स', 'கோர்ஸ்', 'కోర్స్', 'ಕೋರ್ಸ್', 'കോഴ്സ്', 'কোর্স', 'ਕੋਰਸ', 'کورس', 'الطبق', '菜式', '菜式', 'コース', '코스'],
  'Category': ['વિભાગ', 'श्रेणी', 'विभाग', 'வகை', 'విభాగం', 'ವಿಭಾಗ', 'വിഭാഗം', 'বিভাগ', 'ਸ਼੍ਰੇਣੀ', 'زمرہ', 'الفئة', '分类', '分類', 'カテゴリー', '카테고리'],
  'All': ['બધું', 'सभी', 'सर्व', 'அனைத்தும்', 'అన్నీ', 'ಎಲ್ಲಾ', 'എല്ലാം', 'সব', 'ਸਾਰੇ', 'سب', 'الكل', '全部', '全部', 'すべて', '전체'],
  'Veg': ['શાકાહારી', 'शाकाहारी', 'शाकाहारी', 'சைவம்', 'శాకాహారం', 'ಸಸ್ಯಾಹಾರ', 'സസ്യാഹാരം', 'নিরামিষ', 'ਸ਼ਾਕਾਹਾਰੀ', 'سبزی', 'نباتي', '素食', '素食', 'ベジ', '채식'],
  'Non-Veg': ['માંસાહારી', 'मांसाहारी', 'मांसाहारी', 'அசைவம்', 'మాంసాహారం', 'ಮಾಂಸಾಹಾರ', 'മാംസാഹാരം', 'আমিষ', 'ਮਾਸਾਹਾਰੀ', 'گوشت', 'غير نباتي', '荤食', '葷食', 'ノンベジ', '비채식'],
  'Track': ['ઓર્ડર જુઓ', 'ऑर्डर देखें', 'ऑर्डर पहा', 'ஆர்டர் நிலை', 'ఆర్డర్ స్థితి', 'ಆರ್ಡರ್ ಸ್ಥಿತಿ', 'ഓർഡർ നില', 'অর্ডার দেখুন', 'ਆਰਡਰ ਦੇਖੋ', 'آرڈر دیکھیں', 'حالة الطلب', '订单状态', '訂單狀態', '注文状況', '주문 현황'],
  'Menu': ['મેનુ', 'मेन्यू', 'मेनू', 'மெனு', 'మెనూ', 'ಮೆನು', 'മെനു', 'মেনু', 'ਮੀਨੂ', 'مینو', 'القائمة', '菜单', '菜單', 'メニュー', '메뉴'],
  'Add': ['ઉમેરો', 'जोड़ें', 'जोडा', 'சேர்', 'జోడించు', 'ಸೇರಿಸಿ', 'ചേർക്കുക', 'যোগ করুন', 'ਜੋੜੋ', 'شامل کریں', 'أضف', '添加', '加入', '追加', '추가'],
  'added': ['ઉમેર્યું', 'जोड़ा', 'जोडले', 'சேர்த்தது', 'జోడించారు', 'ಸೇರಿಸಲಾಗಿದೆ', 'ചേർത്തു', 'যোগ হয়েছে', 'ਜੋੜਿਆ', 'شامل', 'مضاف', '已添加', '已加入', '追加済み', '추가됨'],
  'Live counter': ['લાઇવ કાઉન્ટર', 'लाइव काउंटर', 'लाइव्ह काउंटर', 'லைவ் கவுண்டர்', 'లైవ్ కౌంటర్', 'ಲೈವ್ ಕೌಂಟರ್', 'ലൈവ് കൗണ്ടർ', 'লাইভ কাউন্টার', 'ਲਾਈਵ ਕਾਊਂਟਰ', 'لائیو کاؤنٹر', 'محطة مباشرة', '现做档口', '現做檔口', 'ライブカウンター', '라이브 카운터'],
  'Browse Menu': ['મેનુ જુઓ', 'मेन्यू देखें', 'मेनू पहा', 'மெனுவைப் பார்', 'మెనూ చూడండి', 'ಮೆನು ನೋಡಿ', 'മെനു കാണുക', 'মেনু দেখুন', 'ਮੀਨੂ ਦੇਖੋ', 'مینو دیکھیں', 'تصفح القائمة', '浏览菜单', '瀏覽菜單', 'メニューを見る', '메뉴 보기'],
  'All courses': ['બધા કોર્સ', 'सभी कोर्स', 'सर्व कोर्स', 'அனைத்து கோர்ஸ்', 'అన్ని కోర్సులు', 'ಎಲ್ಲಾ ಕೋರ್ಸ್', 'എല്ലാ കോഴ്സും', 'সব কোর্স', 'ਸਾਰੇ ਕੋਰਸ', 'تمام کورس', 'كل الأطباق', '全部菜式', '全部菜式', 'すべてのコース', '모든 코스'],
  'Close': ['બંધ કરો', 'बंद करें', 'बंद करा', 'மூடு', 'మూసివేయి', 'ಮುಚ್ಚಿ', 'അടയ്ക്കുക', 'বন্ধ করুন', 'ਬੰਦ ਕਰੋ', 'بند کریں', 'إغلاق', '关闭', '關閉', '閉じる', '닫기'],
  'No dishes found': ['કોઈ વાનગી મળી નથી', 'कोई व्यंजन नहीं मिला', 'एकही पदार्थ सापडला नाही', 'உணவு எதுவும் இல்லை', 'వంటకాలు ఏవీ లేవు', 'ಯಾವುದೇ ಖಾದ್ಯ ಸಿಗಲಿಲ್ಲ', 'വിഭവങ്ങളൊന്നുമില്ല', 'কোনো খাবার পাওয়া যায়নি', 'ਕੋਈ ਪਕਵਾਨ ਨਹੀਂ ਮਿਲਿਆ', 'کوئی ڈش نہیں ملی', 'لا توجد أطباق', '未找到菜品', '找不到菜品', '料理が見つかりません', '요리가 없습니다'],
  'Cart': ['કાર્ટ', 'कार्ट', 'कार्ट', 'கார்ட்', 'కార్ట్', 'ಕಾರ್ಟ್', 'കാർട്ട്', 'কার্ট', 'ਕਾਰਟ', 'کارٹ', 'السلة', '已点', '已點', 'カート', '장바구니'],
  'Place Order': ['ઓર્ડર આપો', 'ऑर्डर दें', 'ऑर्डर द्या', 'ஆர்டர் செய்', 'ఆర్డర్ చేయండి', 'ಆರ್ಡರ್ ಮಾಡಿ', 'ഓർഡർ ചെയ്യുക', 'অর্ডার দিন', 'ਆਰਡਰ ਦਿਓ', 'آرڈر دیں', 'أرسل الطلب', '下单', '下單', '注文する', '주문하기'],
  'Your Order': ['તમારો ઓર્ડર', 'आपका ऑर्डर', 'तुमची ऑर्डर', 'உங்கள் ஆர்டர்', 'మీ ఆర్డర్', 'ನಿಮ್ಮ ಆರ್ಡರ್', 'നിങ്ങളുടെ ഓർഡർ', 'আপনার অর্ডার', 'ਤੁਹਾਡਾ ਆਰਡਰ', 'آپ کا آرڈر', 'طلبك', '您的订单', '您的訂單', 'ご注文', '내 주문'],
  'Total items': ['કુલ વસ્તુઓ', 'कुल आइटम', 'एकूण पदार्थ', 'மொத்தம்', 'మొత్తం', 'ಒಟ್ಟು', 'ആകെ', 'মোট', 'ਕੁੱਲ', 'کل', 'الإجمالي', '合计', '合計', '合計', '합계'],
  'Please wait': ['કૃપા કરી રાહ જુઓ', 'कृपया प्रतीक्षा करें', 'कृपया थांबा', 'காத்திருக்கவும்', 'దయచేసి వేచి ఉండండి', 'ದಯವಿಟ್ಟು ಕಾಯಿರಿ', 'ദയവായി കാത്തിരിക്കുക', 'অনুগ্রহ করে অপেক্ষা করুন', 'ਕਿਰਪਾ ਕਰਕੇ ਉਡੀਕ ਕਰੋ', 'براہ کرم انتظار کریں', 'يرجى الانتظار', '请稍候', '請稍候', 'お待ちください', '잠시 기다려 주세요'],
  'Your current order is being prepared': ['તમારો ઓર્ડર તૈયાર થઈ રહ્યો છે', 'आपका ऑर्डर तैयार हो रहा है', 'तुमची ऑर्डर तयार होत आहे', 'உங்கள் ஆர்டர் தயாராகிறது', 'మీ ఆర్డర్ సిద్ధమవుతోంది', 'ನಿಮ್ಮ ಆರ್ಡರ್ ಸಿದ್ಧವಾಗುತ್ತಿದೆ', 'നിങ്ങളുടെ ഓർഡർ തയ്യാറാകുന്നു', 'আপনার অর্ডার তৈরি হচ্ছে', 'ਤੁਹਾਡਾ ਆਰਡਰ ਤਿਆਰ ਹੋ ਰਿਹਾ ਹੈ', 'آپ کا آرڈر تیار ہو رہا ہے', 'يتم تحضير طلبك', '您的订单正在准备中', '您的訂單正在準備中', 'ご注文を準備中です', '주문하신 음식을 준비 중입니다'],
  'Track Orders': ['ઓર્ડરની સ્થિતિ', 'ऑर्डर की स्थिति', 'ऑर्डरची स्थिती', 'ஆர்டர் நிலை', 'ఆర్డర్ స్థితి', 'ಆರ್ಡರ್ ಸ್ಥಿತಿ', 'ഓർഡർ നില', 'অর্ডারের অবস্থা', 'ਆਰਡਰ ਦੀ ਸਥਿਤੀ', 'آرڈر کی صورتحال', 'حالة الطلبات', '订单状态', '訂單狀態', '注文状況', '주문 현황'],
  'Order Received': ['ઓર્ડર મળી ગયો', 'ऑर्डर मिल गया', 'ऑर्डर मिळाली', 'ஆர்டர் பெறப்பட்டது', 'ఆర్డర్ అందింది', 'ಆರ್ಡರ್ ಸ್ವೀಕರಿಸಲಾಗಿದೆ', 'ഓർഡർ ലഭിച്ചു', 'অর্ডার পাওয়া গেছে', 'ਆਰਡਰ ਮਿਲ ਗਿਆ', 'آرڈر موصول ہو گیا', 'تم استلام الطلب', '已收到订单', '已收到訂單', 'ご注文を受け付けました', '주문 접수됨'],
  'Waiter On The Way': ['વેઇટર આવી રહ્યા છે', 'वेटर आ रहे हैं', 'वेटर येत आहेत', 'பணியாளர் வருகிறார்', 'వెయిటర్ వస్తున్నారు', 'ವೇಟರ್ ಬರುತ್ತಿದ್ದಾರೆ', 'വെയിറ്റർ വരുന്നു', 'ওয়েটার আসছেন', 'ਵੇਟਰ ਆ ਰਹੇ ਹਨ', 'ویٹر آ رہا ہے', 'النادل في الطريق', '服务员正在赶来', '服務員正在趕來', 'スタッフが向かっています', '직원이 가고 있습니다'],
  'Delivered': ['પીરસાઈ ગયું', 'परोस दिया', 'वाढले', 'பரிமாறப்பட்டது', 'వడ్డించారు', 'ಬಡಿಸಲಾಗಿದೆ', 'വിളമ്പി', 'পরিবেশন করা হয়েছে', 'ਪਰੋਸ ਦਿੱਤਾ', 'پیش کر دیا گیا', 'تم التقديم', '已上菜', '已上菜', 'お届け済み', '제공 완료'],
  'Cancelled': ['રદ થયું', 'रद्द', 'रद्द', 'ரத்து', 'రద్దు', 'ರದ್ದು', 'റദ്ദാക്കി', 'বাতিল', 'ਰੱਦ', 'منسوخ', 'أُلغي', '已取消', '已取消', 'キャンセル済み', '취소됨'],
  'What do you need?': ['તમને શું જોઈએ છે?', 'आपको क्या चाहिए?', 'तुम्हाला काय हवे आहे?', 'உங்களுக்கு என்ன வேண்டும்?', 'మీకు ఏమి కావాలి?', 'ನಿಮಗೆ ಏನು ಬೇಕು?', 'നിങ്ങൾക്ക് എന്താണ് വേണ്ടത്?', 'আপনার কী দরকার?', 'ਤੁਹਾਨੂੰ ਕੀ ਚਾਹੀਦਾ ਹੈ?', 'آپ کو کیا چاہیے؟', 'ماذا تحتاج؟', '您需要什么？', '您需要什麼？', 'ご用件は？', '무엇이 필요하세요?'],
  'Request Sent': ['વિનંતી મોકલાઈ ગઈ', 'अनुरोध भेजा गया', 'विनंती पाठवली', 'கோரிக்கை அனுப்பப்பட்டது', 'అభ్యర్థన పంపబడింది', 'ವಿನಂತಿ ಕಳುಹಿಸಲಾಗಿದೆ', 'അഭ്യർത്ഥന അയച്ചു', 'অনুরোধ পাঠানো হয়েছে', 'ਬੇਨਤੀ ਭੇਜੀ ਗਈ', 'درخواست بھیج دی گئی', 'تم إرسال الطلب', '请求已发送', '請求已送出', '送信しました', '요청을 보냈습니다'],
  'Call Waiter': ['વેઇટરને બોલાવો', 'वेटर को बुलाएँ', 'वेटरला बोलवा', 'பணியாளரை அழை', 'వెయిటర్‌ను పిలవండి', 'ವೇಟರ್ ಕರೆಯಿರಿ', 'വെയിറ്ററെ വിളിക്കുക', 'ওয়েটারকে ডাকুন', 'ਵੇਟਰ ਨੂੰ ਬੁਲਾਓ', 'ویٹر کو بلائیں', 'استدعاء النادل', '呼叫服务员', '呼叫服務員', 'スタッフを呼ぶ', '직원 호출'],
  'Clean Table': ['ટેબલ સાફ કરો', 'टेबल साफ़ करें', 'टेबल स्वच्छ करा', 'மேசையைச் சுத்தம் செய்', 'టేబుల్ శుభ్రం చేయండి', 'ಟೇಬಲ್ ಸ್ವಚ್ಛಗೊಳಿಸಿ', 'മേശ വൃത്തിയാക്കുക', 'টেবিল পরিষ্কার করুন', 'ਟੇਬਲ ਸਾਫ਼ ਕਰੋ', 'میز صاف کریں', 'تنظيف الطاولة', '清理餐桌', '清理餐桌', 'テーブルの片付け', '테이블 정리'],
  'Extra Cutlery': ['વધારાની ચમચી-કાંટા', 'अतिरिक्त चम्मच-काँटे', 'जास्तीचे चमचे-काटे', 'கூடுதல் கரண்டி', 'అదనపు స్పూన్లు', 'ಹೆಚ್ಚುವರಿ ಚಮಚ', 'അധിക സ്പൂൺ', 'অতিরিক্ত চামচ', 'ਵਾਧੂ ਚਮਚੇ', 'اضافی چمچ', 'أدوات مائدة إضافية', '加餐具', '加餐具', 'カトラリー追加', '수저 추가'],
  'Water Refill': ['પાણી ફરી ભરો', 'पानी भरें', 'पाणी भरा', 'தண்ணீர் நிரப்பு', 'నీళ్లు నింపండి', 'ನೀರು ತುಂಬಿಸಿ', 'വെള്ളം നിറയ്ക്കുക', 'জল ভরুন', 'ਪਾਣੀ ਭਰੋ', 'پانی بھریں', 'إعادة ملء الماء', '加水', '加水', 'お水のおかわり', '물 리필'],
  'Loading menu': ['મેનુ ખુલી રહ્યું છે', 'मेन्यू खुल रहा है', 'मेनू उघडत आहे', 'மெனு திறக்கிறது', 'మెనూ తెరుచుకుంటోంది', 'ಮೆನು ತೆರೆಯುತ್ತಿದೆ', 'മെനു തുറക്കുന്നു', 'মেনু খুলছে', 'ਮੀਨੂ ਖੁੱਲ੍ਹ ਰਿਹਾ ਹੈ', 'مینو کھل رہا ہے', 'جارٍ فتح القائمة', '正在加载菜单', '正在載入菜單', 'メニューを読み込み中', '메뉴를 여는 중'],
  'Your order will be served in few minutes': ['તમારો ઓર્ડર થોડી મિનિટોમાં પીરસાશે', 'आपका ऑर्डर कुछ ही मिनटों में परोसा जाएगा', 'तुमची ऑर्डर काही मिनिटांत वाढली जाईल', 'உங்கள் ஆர்டர் சில நிமிடங்களில் பரிமாறப்படும்', 'మీ ఆర్డర్ కొన్ని నిమిషాల్లో వడ్డించబడుతుంది', 'ನಿಮ್ಮ ಆರ್ಡರ್ ಕೆಲವೇ ನಿಮಿಷಗಳಲ್ಲಿ ಬಡಿಸಲಾಗುವುದು', 'നിങ്ങളുടെ ഓർഡർ കുറച്ച് മിനിറ്റിനുള്ളിൽ വിളമ്പും', 'আপনার অর্ডার কয়েক মিনিটের মধ্যে পরিবেশন করা হবে', 'ਤੁਹਾਡਾ ਆਰਡਰ ਕੁਝ ਮਿੰਟਾਂ ਵਿੱਚ ਪਰੋਸਿਆ ਜਾਵੇਗਾ', 'آپ کا آرڈر چند منٹوں میں پیش کیا جائے گا', 'سيتم تقديم طلبك خلال دقائق', '您的菜品将在几分钟内上桌', '您的菜品將在幾分鐘內上桌', 'ご注文の品はまもなくお届けします', '주문하신 음식이 몇 분 안에 나옵니다'],
  'No active orders': ['કોઈ ચાલુ ઓર્ડર નથી', 'कोई चालू ऑर्डर नहीं', 'चालू ऑर्डर नाही', 'செயலில் ஆர்டர் இல்லை', 'ప్రస్తుతం ఆర్డర్ లేదు', 'ಯಾವುದೇ ಸಕ್ರಿಯ ಆರ್ಡರ್ ಇಲ್ಲ', 'സജീവ ഓർഡറുകളില്ല', 'কোনো চলতি অর্ডার নেই', 'ਕੋਈ ਚਾਲੂ ਆਰਡਰ ਨਹੀਂ', 'کوئی جاری آرڈر نہیں', 'لا توجد طلبات حالية', '暂无进行中的订单', '暫無進行中的訂單', '進行中の注文はありません', '진행 중인 주문이 없습니다'],
  'Back to Menu': ['મેનુ પર પાછા', 'मेन्यू पर वापस', 'मेनूवर परत', 'மெனுவுக்குத் திரும்பு', 'మెనూకు తిరిగి', 'ಮೆನುಗೆ ಹಿಂತಿರುಗಿ', 'മെനുവിലേക്ക് മടങ്ങുക', 'মেনুতে ফিরুন', 'ਮੀਨੂ ’ਤੇ ਵਾਪਸ', 'مینو پر واپس', 'العودة إلى القائمة', '返回菜单', '返回菜單', 'メニューに戻る', '메뉴로 돌아가기'],
  'Place Another Order': ['બીજો ઓર્ડર આપો', 'एक और ऑर्डर दें', 'आणखी ऑर्डर द्या', 'மற்றொரு ஆர்டர் செய்', 'మరో ఆర్డర్ చేయండి', 'ಇನ್ನೊಂದು ಆರ್ಡರ್ ಮಾಡಿ', 'മറ്റൊരു ഓർഡർ ചെയ്യുക', 'আরেকটি অর্ডার দিন', 'ਇੱਕ ਹੋਰ ਆਰਡਰ ਦਿਓ', 'ایک اور آرڈر دیں', 'اطلب مرة أخرى', '再点一单', '再點一單', '追加で注文する', '추가 주문하기'],
  'How is your experience using the app?': ['એપ વાપરવાનો તમારો અનુભવ કેવો રહ્યો?', 'ऐप इस्तेमाल करने का आपका अनुभव कैसा रहा?', 'ॲप वापरण्याचा तुमचा अनुभव कसा होता?', 'செயலியைப் பயன்படுத்திய அனுபவம் எப்படி?', 'యాప్ వాడిన అనుభవం ఎలా ఉంది?', 'ಆ್ಯಪ್ ಬಳಸಿದ ಅನುಭವ ಹೇಗಿತ್ತು?', 'ആപ്പ് ഉപയോഗിച്ച അനുഭവം എങ്ങനെ?', 'অ্যাপ ব্যবহারের অভিজ্ঞতা কেমন?', 'ਐਪ ਵਰਤਣ ਦਾ ਤਜਰਬਾ ਕਿਹੋ ਜਿਹਾ ਰਿਹਾ?', 'ایپ استعمال کرنے کا تجربہ کیسا رہا؟', 'كيف كانت تجربتك مع التطبيق؟', '您对应用的体验如何？', '您對應用程式的體驗如何？', 'アプリの使い心地はいかがでしたか？', '앱 사용 경험은 어떠셨나요?'],
  'Excellent': ['ઉત્તમ', 'बेहतरीन', 'उत्कृष्ट', 'மிகச் சிறப்பு', 'అద్భుతం', 'ಅತ್ಯುತ್ತಮ', 'മികച്ചത്', 'চমৎকার', 'ਸ਼ਾਨਦਾਰ', 'بہترین', 'ممتاز', '非常好', '非常好', '最高', '아주 좋음'],
  'Good': ['સારું', 'अच्छा', 'चांगला', 'நன்று', 'బాగుంది', 'ಚೆನ್ನಾಗಿದೆ', 'നല്ലത്', 'ভালো', 'ਵਧੀਆ', 'اچھا', 'جيد', '好', '好', '良い', '좋음'],
  'Average': ['ઠીક', 'ठीक-ठाक', 'ठीक', 'சுமார்', 'పర్వాలేదు', 'ಪರವಾಗಿಲ್ಲ', 'ശരാശരി', 'মোটামুটি', 'ਠੀਕ', 'ٹھیک', 'متوسط', '一般', '一般', 'ふつう', '보통'],
  'Drinking water': ['પીવાનું પાણી', 'पीने का पानी', 'पिण्याचे पाणी', 'குடிநீர்', 'తాగునీరు', 'ಕುಡಿಯುವ ನೀರು', 'കുടിവെള്ളം', 'খাবার জল', 'ਪੀਣ ਵਾਲਾ ਪਾਣੀ', 'پینے کا پانی', 'مياه للشرب', '饮用水', '飲用水', '飲み水', '마실 물'],
  'Extra plates': ['વધારાની પ્લેટ', 'अतिरिक्त प्लेट', 'जास्तीच्या प्लेट', 'கூடுதல் தட்டுகள்', 'అదనపు ప్లేట్లు', 'ಹೆಚ್ಚುವರಿ ತಟ್ಟೆಗಳು', 'അധിക പ്ലേറ്റുകൾ', 'অতিরিক্ত প্লেট', 'ਵਾਧੂ ਪਲੇਟਾਂ', 'اضافی پلیٹیں', 'أطباق إضافية', '加盘子', '加盤子', '取り皿の追加', '앞접시 추가'],
  'Napkins / tissues': ['નેપકિન / ટિશ્યુ', 'नैपकिन / टिशू', 'नॅपकिन / टिश्यू', 'நாப்கின் / டிஷ்யூ', 'నాప్కిన్ / టిష్యూ', 'ನ್ಯಾಪ್ಕಿನ್ / ಟಿಶ್ಯೂ', 'നാപ്കിൻ / ടിഷ്യു', 'ন্যাপকিন / টিস্যু', 'ਨੈਪਕਿਨ / ਟਿਸ਼ੂ', 'نیپکن / ٹشو', 'مناديل', '餐巾纸', '餐巾紙', 'ナプキン / ティッシュ', '냅킨 / 티슈'],
  'Please clean the table': ['કૃપા કરી ટેબલ સાફ કરો', 'कृपया टेबल साफ़ करें', 'कृपया टेबल स्वच्छ करा', 'மேசையைச் சுத்தம் செய்யவும்', 'దయచేసి టేబుల్ శుభ్రం చేయండి', 'ದಯವಿಟ್ಟು ಟೇಬಲ್ ಸ್ವಚ್ಛಗೊಳಿಸಿ', 'ദയവായി മേശ വൃത്തിയാക്കുക', 'অনুগ্রহ করে টেবিল পরিষ্কার করুন', 'ਕਿਰਪਾ ਕਰਕੇ ਟੇਬਲ ਸਾਫ਼ ਕਰੋ', 'براہ کرم میز صاف کریں', 'يرجى تنظيف الطاولة', '请清理餐桌', '請清理餐桌', 'テーブルを片付けてください', '테이블을 치워 주세요'],
  'Select what you need': ['જોઈતી વસ્તુ પસંદ કરો', 'जो चाहिए वह चुनें', 'हवे ते निवडा', 'தேவையானதைத் தேர்ந்தெடுக்கவும்', 'కావలసినది ఎంచుకోండి', 'ಬೇಕಾದದ್ದನ್ನು ಆಯ್ಕೆಮಾಡಿ', 'ആവശ്യമുള്ളത് തിരഞ്ഞെടുക്കുക', 'যা দরকার বেছে নিন', 'ਜੋ ਚਾਹੀਦਾ ਹੈ ਚੁਣੋ', 'جو چاہیے منتخب کریں', 'اختر ما تحتاجه', '请选择所需物品', '請選擇所需物品', '必要なものを選んでください', '필요한 것을 선택하세요'],
  'Send Request': ['વિનંતી મોકલો', 'अनुरोध भेजें', 'विनंती पाठवा', 'கோரிக்கையை அனுப்பு', 'అభ్యర్థన పంపండి', 'ವಿನಂತಿ ಕಳುಹಿಸಿ', 'അഭ്യർത്ഥന അയയ്ക്കുക', 'অনুরোধ পাঠান', 'ਬੇਨਤੀ ਭੇਜੋ', 'درخواست بھیجیں', 'أرسل الطلب', '发送请求', '送出請求', '送信する', '요청 보내기'],
  'Cancel': ['રદ કરો', 'रद्द करें', 'रद्द करा', 'ரத்து செய்', 'రద్దు చేయి', 'ರದ್ದುಮಾಡಿ', 'റദ്ദാക്കുക', 'বাতিল করুন', 'ਰੱਦ ਕਰੋ', 'منسوخ کریں', 'إلغاء', '取消', '取消', 'キャンセル', '취소'],
  'Order History': ['ઓર્ડર ઇતિહાસ', 'ऑर्डर इतिहास', 'ऑर्डर इतिहास', 'ஆர்டர் வரலாறு', 'ఆర్డర్ చరిత్ర', 'ಆರ್ಡರ್ ಇತಿಹಾಸ', 'ഓർഡർ ചരിത്രം', 'অর্ডারের ইতিহাস', 'ਆਰਡਰ ਇਤਿਹਾਸ', 'پچھلے آرڈر', 'الطلبات السابقة', '历史订单', '歷史訂單', '注文履歴', '주문 내역'],
}

const PHRASES = new Map(Object.entries(ROWS).map(([en, list]) => [en.toLowerCase(), list]))

/* A fixed English phrase in a language, or '' when there is none */
export function phrase(en, code) {
  const l = langInfo(code)
  if (!l) return ''
  const i = COLS.indexOf(l.code)
  if (i < 0) return ''
  const row = PHRASES.get(String(en || '').trim().toLowerCase())
  return row && row[i] ? row[i] : ''
}

/* Which languages have their buttons translated (for the admin screen) */
export const hasPhrases = code => { const l = langInfo(code); return !!l && COLS.includes(l.code) }

/* Text in a different script from English counts as a translation; text
   that is just the English again (or empty) does not - nothing is shown. */
export function differs(en, local) {
  const a = String(en || '').trim().toLowerCase(), b = String(local || '').trim().toLowerCase()
  return !!b && a !== b
}
