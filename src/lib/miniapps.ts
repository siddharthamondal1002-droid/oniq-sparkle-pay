// ONIQ Mini Apps — partner integrations via universal/deep links + in-app browser.
// Strategy: no partner API keys needed. Apps open INSIDE ONIQ (Capacitor in-app
// browser sheet on device, new tab on web). Deep links hand off to the native
// partner app when installed, pre-filled with context (destination, amount).

export type CountryCode = "IN" | "US" | "GB" | "AE" | "CA" | "AU" | "SG";

export type MiniApp = {
  id: string;
  name: string;
  tagline: string;
  category: "food" | "rides" | "quickcommerce" | "services" | "payments" | "social" | "shopping" | "beauty" | "fashion" | "entertainment";
  url: string; // web URL opened in the in-app browser / same-tab fallback
  color: string; // brand tile color
  letter: string; // fallback monogram
  androidPackage?: string; // Android package id for intent:// deep launch
  appScheme?: string; // iOS/web deep-link scheme (e.g. "uber://"); triggers app-first with https fallback
  emoji?: string; // optional tile emoji instead of letter
  countries: readonly CountryCode[] | "*"; // where the app is offered; "*" = everywhere
};

/** True when `app` is offered in `country`. */
export function appAvailableIn(app: Pick<MiniApp, "countries">, country: CountryCode): boolean {
  return app.countries === "*" || app.countries.includes(country);
}


export const MINI_APPS: MiniApp[] = [
  // Food
  { id: "swiggy", name: "Swiggy", tagline: "Food & grocery delivery", category: "food", url: "https://www.swiggy.com", color: "#FC8019", letter: "S", androidPackage: "in.swiggy.android", appScheme: "swiggy://", emoji: "🛵", countries: ["IN"] },
  { id: "zomato", name: "Zomato", tagline: "Restaurants & delivery", category: "food", url: "https://www.zomato.com", color: "#E23744", letter: "Z", androidPackage: "com.application.zomato", appScheme: "zomato://", emoji: "🍽️", countries: ["IN", "AE"] },
  { id: "dominos", name: "Domino's", tagline: "Pizza delivery", category: "food", url: "https://www.dominos.co.in", color: "#0A6EBD", letter: "D", emoji: "🍕", countries: ["IN"] },
  { id: "ubereats", name: "Uber Eats", tagline: "Food delivery", category: "food", url: "https://www.ubereats.com", color: "#06C167", letter: "U", androidPackage: "com.ubercab.eats", emoji: "🍔", countries: ["US", "GB", "AE", "CA", "AU", "SG"] },
  { id: "doordash", name: "DoorDash", tagline: "Restaurants to your door", category: "food", url: "https://www.doordash.com", color: "#FF3008", letter: "D", androidPackage: "com.dd.doordash", emoji: "🥡", countries: ["US", "CA", "AU"] },
  { id: "deliveroo", name: "Deliveroo", tagline: "Food, fast", category: "food", url: "https://deliveroo.co.uk", color: "#00CCBC", letter: "D", androidPackage: "com.deliveroo.orderapp", emoji: "🍱", countries: ["GB", "AE", "SG"] },
  { id: "grubhub", name: "Grubhub", tagline: "Takeout & delivery", category: "food", url: "https://www.grubhub.com", color: "#FF8000", letter: "G", emoji: "🥪", countries: ["US"] },
  { id: "talabat", name: "Talabat", tagline: "Food & groceries", category: "food", url: "https://www.talabat.com", color: "#FF5A00", letter: "T", emoji: "🍟", countries: ["AE"] },
  { id: "foodpanda", name: "foodpanda", tagline: "Food & pandamart", category: "food", url: "https://www.foodpanda.sg", color: "#D70F64", letter: "F", emoji: "🐼", countries: ["SG"] },
  { id: "menulog", name: "Menulog", tagline: "Aussie takeaway", category: "food", url: "https://www.menulog.com.au", color: "#FF8000", letter: "M", emoji: "🍕", countries: ["AU"] },
  // Rides 🚗
  { id: "uber", name: "Uber", tagline: "Book a cab", category: "rides", url: "https://m.uber.com", color: "#000000", letter: "U", androidPackage: "com.ubercab", appScheme: "uber://", emoji: "🚕", countries: "*" },
  { id: "ola", name: "Ola", tagline: "Cabs & autos", category: "rides", url: "https://book.olacabs.com", color: "#a4c639", letter: "O", androidPackage: "com.olacabs.customer", appScheme: "olacabs://", emoji: "🚖", countries: ["IN", "GB", "AU"] },
  { id: "rapido", name: "Rapido", tagline: "Bike taxis & autos", category: "rides", url: "https://rapido.bike", color: "#FFCB05", letter: "R", androidPackage: "com.rapido.passenger", appScheme: "rapido://", emoji: "🏍️", countries: ["IN"] },
  { id: "indrive", name: "inDrive", tagline: "Name your fare", category: "rides", url: "https://indrive.com", color: "#C1F11D", letter: "I", androidPackage: "sinet.startup.inDriver", appScheme: "indrive://", emoji: "💸", countries: ["IN", "US"] },
  { id: "nammayatri", name: "Namma Yatri", tagline: "Zero-commission autos", category: "rides", url: "https://nammayatri.in", color: "#FFCE00", letter: "N", androidPackage: "in.juspay.nammayatri", emoji: "🛺", countries: ["IN"] },
  { id: "blusmart", name: "BluSmart", tagline: "All-electric cabs", category: "rides", url: "https://blu-smart.com", color: "#003DA5", letter: "B", androidPackage: "com.blusmart.rider", emoji: "⚡", countries: ["IN"] },
  { id: "lyft", name: "Lyft", tagline: "Rides in minutes", category: "rides", url: "https://www.lyft.com", color: "#FF00BF", letter: "L", androidPackage: "me.lyft.android", appScheme: "lyft://", emoji: "🚗", countries: ["US", "CA"] },
  { id: "bolt", name: "Bolt", tagline: "Fast, affordable rides", category: "rides", url: "https://bolt.eu", color: "#34D186", letter: "B", androidPackage: "ee.mtakso.client", emoji: "⚡", countries: ["GB"] },
  { id: "careem", name: "Careem", tagline: "Rides & more", category: "rides", url: "https://www.careem.com", color: "#37B44A", letter: "C", androidPackage: "com.careem.acma", emoji: "🚖", countries: ["AE"] },
  { id: "grab", name: "Grab", tagline: "Rides & deliveries", category: "rides", url: "https://www.grab.com", color: "#00B14F", letter: "G", androidPackage: "com.grabtaxi.passenger", appScheme: "grab://", emoji: "🛵", countries: ["SG"] },
  { id: "didi", name: "DiDi", tagline: "Everyday rides", category: "rides", url: "https://web.didiglobal.com", color: "#FF7A45", letter: "D", androidPackage: "com.didiglobal.passenger", emoji: "🚕", countries: ["AU"] },
  // Quick commerce 🛒
  { id: "zepto", name: "Zepto", tagline: "Groceries in 10 min", category: "quickcommerce", url: "https://www.zeptonow.com", color: "#7C3AED", letter: "Z", androidPackage: "com.zeptoconsumerapp", appScheme: "zepto://", emoji: "⚡", countries: ["IN"] },
  { id: "blinkit", name: "Blinkit", tagline: "Groceries in minutes", category: "quickcommerce", url: "https://blinkit.com", color: "#F8CB46", letter: "B", androidPackage: "com.grofers.customerapp", appScheme: "blinkit://", emoji: "🛍️", countries: ["IN"] },
  { id: "instamart", name: "Swiggy Instamart", tagline: "Instant groceries", category: "quickcommerce", url: "https://www.swiggy.com/instamart", color: "#FC8019", letter: "I", androidPackage: "in.swiggy.android", appScheme: "swiggy://", emoji: "🥬", countries: ["IN"] },
  { id: "bigbasket", name: "BigBasket", tagline: "Groceries & essentials", category: "quickcommerce", url: "https://www.bigbasket.com", color: "#84C225", letter: "B", androidPackage: "com.bigbasket.mobileapp", emoji: "🧺", countries: ["IN"] },
  { id: "instacart", name: "Instacart", tagline: "Groceries delivered", category: "quickcommerce", url: "https://www.instacart.com", color: "#43B02A", letter: "I", androidPackage: "com.instacart.client", emoji: "🥕", countries: ["US", "CA"] },
  { id: "gopuff", name: "Gopuff", tagline: "Essentials in minutes", category: "quickcommerce", url: "https://www.gopuff.com", color: "#0FA8E0", letter: "G", emoji: "🚀", countries: ["US", "GB"] },
  { id: "noonminutes", name: "noon Minutes", tagline: "15-minute delivery", category: "quickcommerce", url: "https://www.noon.com", color: "#FEEE00", letter: "N", emoji: "🛒", countries: ["AE"] },
  { id: "fairprice", name: "FairPrice", tagline: "Groceries & essentials", category: "quickcommerce", url: "https://www.fairprice.com.sg", color: "#0072CE", letter: "F", emoji: "🧺", countries: ["SG"] },
  // Payments
  { id: "gpay", name: "Google Pay", tagline: "UPI payments", category: "payments", url: "https://pay.google.com", color: "#4285F4", letter: "G", appScheme: "tez://", emoji: "💳", countries: "*" },
  { id: "phonepe", name: "PhonePe", tagline: "UPI & recharges", category: "payments", url: "https://www.phonepe.com", color: "#5F259F", letter: "P", appScheme: "phonepe://", emoji: "📲", countries: ["IN"] },
  { id: "paytm", name: "Paytm", tagline: "Payments & bills", category: "payments", url: "https://paytm.com", color: "#00BAF2", letter: "P", appScheme: "paytmmp://", emoji: "💰", countries: ["IN"] },
  { id: "paypal", name: "PayPal", tagline: "Send & spend safely", category: "payments", url: "https://www.paypal.com", color: "#003087", letter: "P", androidPackage: "com.paypal.android.p2pmobile", emoji: "💙", countries: ["US", "GB", "AE", "CA", "AU", "SG"] },
  { id: "venmo", name: "Venmo", tagline: "Split & send", category: "payments", url: "https://venmo.com", color: "#3D95CE", letter: "V", emoji: "💸", countries: ["US"] },
  { id: "cashapp", name: "Cash App", tagline: "Money, simplified", category: "payments", url: "https://cash.app", color: "#00D632", letter: "C", emoji: "💵", countries: ["US", "GB"] },
  { id: "revolut", name: "Revolut", tagline: "All-in-one finance", category: "payments", url: "https://www.revolut.com", color: "#0666EB", letter: "R", emoji: "💳", countries: ["GB", "AU", "SG"] },

  // Social
  { id: "instagram", name: "Instagram", tagline: "Photos & reels", category: "social", url: "https://www.instagram.com", color: "#E1306C", letter: "I", emoji: "📸", countries: "*" },
  { id: "youtube", name: "YouTube", tagline: "Videos & shorts", category: "social", url: "https://m.youtube.com", color: "#FF0000", letter: "Y", emoji: "▶️", countries: "*" },
  { id: "x", name: "X", tagline: "What's happening", category: "social", url: "https://x.com", color: "#111111", letter: "X", emoji: "✖️", countries: "*" },
  { id: "reddit", name: "Reddit", tagline: "Communities", category: "social", url: "https://www.reddit.com", color: "#FF4500", letter: "R", emoji: "👽", countries: "*" },
  { id: "facebook", name: "Facebook", tagline: "Friends & groups", category: "social", url: "https://m.facebook.com", color: "#1877F2", letter: "F", emoji: "📘", countries: "*" },
  { id: "whatsapp", name: "WhatsApp", tagline: "Messaging", category: "social", url: "https://www.whatsapp.com", color: "#25D366", letter: "W", emoji: "💬", countries: "*" },
  { id: "telegram", name: "Telegram", tagline: "Chats & channels", category: "social", url: "https://web.telegram.org", color: "#26A5E4", letter: "T", emoji: "✈️", countries: "*" },
  { id: "tiktok", name: "TikTok", tagline: "Short videos", category: "social", url: "https://www.tiktok.com", color: "#010101", letter: "T", emoji: "🎵", countries: "*" },
  { id: "linkedin", name: "LinkedIn", tagline: "Professional network", category: "social", url: "https://www.linkedin.com", color: "#0A66C2", letter: "L", emoji: "💼", countries: "*" },
  { id: "snapchat", name: "Snapchat", tagline: "Snaps & stories", category: "social", url: "https://web.snapchat.com", color: "#C9A200", letter: "S", emoji: "👻", countries: "*" },
  { id: "pinterest", name: "Pinterest", tagline: "Ideas & inspo", category: "social", url: "https://www.pinterest.com", color: "#E60023", letter: "P", emoji: "📌", countries: "*" },
  { id: "threads", name: "Threads", tagline: "Text conversations", category: "social", url: "https://www.threads.net", color: "#1A1A1A", letter: "T", emoji: "🧵", countries: "*" },
  { id: "discord", name: "Discord", tagline: "Servers & voice", category: "social", url: "https://discord.com/app", color: "#5865F2", letter: "D", emoji: "🎮", countries: "*" },
  { id: "twitch", name: "Twitch", tagline: "Live streams", category: "social", url: "https://m.twitch.tv", color: "#9146FF", letter: "T", emoji: "📡", countries: "*" },
  // Shopping
  { id: "amazon", name: "Amazon", tagline: "Everything store", category: "shopping", url: "https://www.amazon.in", color: "#FF9900", letter: "A", emoji: "📦", countries: ["IN"] },
  { id: "amazon-global", name: "Amazon", tagline: "Everything store", category: "shopping", url: "https://www.amazon.com", color: "#FF9900", letter: "A", emoji: "📦", countries: ["US", "GB", "AE", "CA", "AU", "SG"] },
  { id: "flipkart", name: "Flipkart", tagline: "Fashion & electronics", category: "shopping", url: "https://www.flipkart.com", color: "#2874F0", letter: "F", emoji: "🛒", countries: ["IN"] },
  { id: "ebay", name: "eBay", tagline: "Buy & sell anything", category: "shopping", url: "https://www.ebay.com", color: "#E53238", letter: "E", emoji: "🏷️", countries: ["US", "GB", "CA", "AU"] },
  { id: "walmart", name: "Walmart", tagline: "Save money, live better", category: "shopping", url: "https://www.walmart.com", color: "#0071CE", letter: "W", emoji: "🛒", countries: ["US", "CA"] },
  { id: "target", name: "Target", tagline: "Style & essentials", category: "shopping", url: "https://www.target.com", color: "#CC0000", letter: "T", emoji: "🎯", countries: ["US"] },
  { id: "noon", name: "noon", tagline: "Middle-East marketplace", category: "shopping", url: "https://www.noon.com", color: "#FEEE00", letter: "N", emoji: "🌟", countries: ["AE"] },
  { id: "lazada", name: "Lazada", tagline: "Southeast-Asia shopping", category: "shopping", url: "https://www.lazada.sg", color: "#0F136D", letter: "L", emoji: "📦", countries: ["SG"] },
  { id: "shopee", name: "Shopee", tagline: "Deals & flash sales", category: "shopping", url: "https://shopee.sg", color: "#EE4D2D", letter: "S", emoji: "🛍️", countries: ["SG"] },
  // Beauty 💄
  { id: "nykaa", name: "Nykaa", tagline: "Beauty & cosmetics", category: "beauty", url: "https://www.nykaa.com", color: "#FC2779", letter: "N", androidPackage: "com.fsn.nykaa", emoji: "💄", countries: ["IN"] },
  { id: "tira", name: "Tira", tagline: "Beauty by Reliance", category: "beauty", url: "https://www.tirabeauty.com", color: "#9D174D", letter: "T", emoji: "✨", countries: ["IN"] },
  { id: "purplle", name: "Purplle", tagline: "Affordable beauty", category: "beauty", url: "https://www.purplle.com", color: "#6B21A8", letter: "P", androidPackage: "com.manash.purplle", emoji: "💜", countries: ["IN"] },
  { id: "sugar", name: "Sugar Cosmetics", tagline: "Bold, break-proof makeup", category: "beauty", url: "https://www.sugarcosmetics.com", color: "#111111", letter: "S", emoji: "💋", countries: ["IN"] },
  { id: "myglamm", name: "MyGlamm", tagline: "Makeup & skincare", category: "beauty", url: "https://www.myglamm.com", color: "#E91E63", letter: "M", emoji: "🌸", countries: ["IN"] },
  { id: "sephora", name: "Sephora", tagline: "Prestige beauty", category: "beauty", url: "https://www.sephora.com", color: "#000000", letter: "S", androidPackage: "com.sephora", emoji: "🖤", countries: ["US", "GB", "AE", "CA", "AU", "SG"] },
  { id: "ulta", name: "Ulta Beauty", tagline: "Beauty superstore", category: "beauty", url: "https://www.ulta.com", color: "#E4551F", letter: "U", emoji: "💅", countries: ["US"] },
  { id: "boots", name: "Boots", tagline: "Pharmacy & beauty", category: "beauty", url: "https://www.boots.com", color: "#05054B", letter: "B", emoji: "🧴", countries: ["GB"] },
  { id: "mecca", name: "MECCA", tagline: "Beauty destination", category: "beauty", url: "https://www.mecca.com", color: "#B45309", letter: "M", emoji: "✨", countries: ["AU"] },
  { id: "watsons", name: "Watsons", tagline: "Health & beauty", category: "beauty", url: "https://www.watsons.com.sg", color: "#00B0B9", letter: "W", emoji: "🧴", countries: ["SG"] },
  // Fashion 👗
  { id: "myntra", name: "Myntra", tagline: "Fashion & lifestyle", category: "fashion", url: "https://www.myntra.com", color: "#FF3F6C", letter: "M", androidPackage: "com.myntra.android", appScheme: "myntra://", emoji: "👗", countries: ["IN"] },
  { id: "ajio", name: "AJIO", tagline: "Curated fashion", category: "fashion", url: "https://www.ajio.com", color: "#2C4152", letter: "A", androidPackage: "com.ril.ajio", emoji: "🧥", countries: ["IN"] },
  { id: "meesho", name: "Meesho", tagline: "Budget-friendly finds", category: "fashion", url: "https://www.meesho.com", color: "#F43397", letter: "M", androidPackage: "com.meesho.supply", emoji: "🛍️", countries: ["IN"] },
  { id: "nykaafashion", name: "Nykaa Fashion", tagline: "Trendy fits", category: "fashion", url: "https://www.nykaafashion.com", color: "#FC2779", letter: "N", emoji: "👠", countries: ["IN"] },
  { id: "bewakoof", name: "Bewakoof", tagline: "Streetwear & tees", category: "fashion", url: "https://www.bewakoof.com", color: "#FFD600", letter: "B", emoji: "😎", countries: ["IN"] },
  { id: "asos", name: "ASOS", tagline: "Fashion forward", category: "fashion", url: "https://www.asos.com", color: "#2D2D2D", letter: "A", emoji: "🧢", countries: ["US", "GB", "AU"] },
  { id: "hm", name: "H&M", tagline: "Everyday fashion", category: "fashion", url: "https://www2.hm.com", color: "#E50010", letter: "H", emoji: "👕", countries: "*" },
  { id: "zara", name: "Zara", tagline: "Runway to street", category: "fashion", url: "https://www.zara.com", color: "#1A1A1A", letter: "Z", emoji: "🕶️", countries: "*" },
  { id: "shein", name: "SHEIN", tagline: "Fast fashion", category: "fashion", url: "https://www.shein.com", color: "#111111", letter: "S", emoji: "🛒", countries: ["US", "GB", "AE", "CA", "AU", "SG"] },
  { id: "namshi", name: "Namshi", tagline: "Middle-East fashion", category: "fashion", url: "https://www.namshi.com", color: "#70163C", letter: "N", emoji: "👜", countries: ["AE"] },
  // Entertainment 🍿
  { id: "netflix", name: "Netflix", tagline: "Movies & series", category: "entertainment", url: "https://www.netflix.com", color: "#E50914", letter: "N", androidPackage: "com.netflix.mediaclient", appScheme: "nflx://", emoji: "🎬", countries: "*" },
  { id: "primevideo", name: "Amazon Prime Video", tagline: "Prime originals & rentals", category: "entertainment", url: "https://www.primevideo.com", color: "#1A98FF", letter: "P", androidPackage: "com.amazon.avod.thirdpartyclient", emoji: "🎥", countries: "*" },
  { id: "jiohotstar", name: "JioHotstar", tagline: "Cricket, movies & TV", category: "entertainment", url: "https://www.hotstar.com", color: "#122447", letter: "J", androidPackage: "in.startv.hotstar", emoji: "🏏", countries: ["IN"] },
  { id: "sonyliv", name: "SonyLIV", tagline: "Sports & originals", category: "entertainment", url: "https://www.sonyliv.com", color: "#5A2BAF", letter: "S", androidPackage: "com.sonyliv", emoji: "📺", countries: ["IN"] },
  { id: "zee5", name: "ZEE5", tagline: "Desi entertainment", category: "entertainment", url: "https://www.zee5.com", color: "#8230C6", letter: "Z", androidPackage: "com.graymatrix.did", emoji: "🎭", countries: ["IN"] },
  { id: "mxplayer", name: "MX Player", tagline: "Free movies & shows", category: "entertainment", url: "https://www.mxplayer.in", color: "#3C5AF3", letter: "M", androidPackage: "com.mxtech.videoplayer.ad", emoji: "▶️", countries: ["IN"] },
  { id: "disneyplus", name: "Disney+", tagline: "Disney, Marvel, Star Wars", category: "entertainment", url: "https://www.disneyplus.com", color: "#113CCF", letter: "D", androidPackage: "com.disney.disneyplus", emoji: "🏰", countries: ["US", "GB", "AE", "CA", "AU", "SG"] },
  { id: "hulu", name: "Hulu", tagline: "Stream TV & movies", category: "entertainment", url: "https://www.hulu.com", color: "#1CE783", letter: "H", emoji: "📺", countries: ["US"] },
  { id: "iplayer", name: "BBC iPlayer", tagline: "British TV, free", category: "entertainment", url: "https://www.bbc.co.uk/iplayer", color: "#FF4C98", letter: "B", emoji: "🎞️", countries: ["GB"] },
  { id: "stan", name: "Stan", tagline: "Aussie streaming", category: "entertainment", url: "https://www.stan.com.au", color: "#0166FF", letter: "S", emoji: "🎬", countries: ["AU"] },
  { id: "shahid", name: "Shahid", tagline: "Arabic originals", category: "entertainment", url: "https://shahid.mbc.net", color: "#10B981", letter: "S", emoji: "🌙", countries: ["AE"] },
  { id: "mewatch", name: "meWATCH", tagline: "Singapore TV", category: "entertainment", url: "https://www.mewatch.sg", color: "#E11D48", letter: "M", emoji: "📺", countries: ["SG"] },
  // Services 🛠
  { id: "urbancompany", name: "Urban Company", tagline: "Home services on demand", category: "services", url: "https://www.urbancompany.com", color: "#E91E63", letter: "U", androidPackage: "com.urbanclap.urbanclap", emoji: "🧹", countries: ["IN", "AE", "SG"] },
  { id: "snabbit", name: "Snabbit", tagline: "10-min home help", category: "services", url: "https://snabbit.com", color: "#FF6B35", letter: "S", androidPackage: "com.snabbit.customer", emoji: "⚡", countries: ["IN"] },
  { id: "nobroker", name: "NoBroker", tagline: "Rent & buy, no brokerage", category: "services", url: "https://www.nobroker.in", color: "#DC2626", letter: "N", androidPackage: "com.nobroker.app", emoji: "🏠", countries: ["IN"] },
  { id: "porter", name: "Porter", tagline: "Trucks, movers, couriers", category: "services", url: "https://porter.in", color: "#FBBF24", letter: "P", androidPackage: "com.theporter.android.customerapp", emoji: "🚚", countries: ["IN"] },
];

/** Category names — `label` is the original (English & every non-Hindi
 *  locale); `labelHi` renders only when the active locale is `hi`. */
export const CATEGORY_LABELS: Record<MiniApp["category"], { label: string; labelHi: string }> = {
  food: { label: "Food delivery", labelHi: "खाना" },
  rides: { label: "🚗 Rides", labelHi: "🚗 राइड्स" },
  quickcommerce: { label: "🛒 Quick commerce", labelHi: "🛒 झटपट किराना" },
  services: { label: "🛠 get it done", labelHi: "🛠 काम करवाओ" },
  payments: { label: "Payments", labelHi: "पेमेंट्स" },
  social: { label: "Social", labelHi: "सोशल" },
  shopping: { label: "Shopping", labelHi: "शॉपिंग" },
  beauty: { label: "Beauty 💄", labelHi: "ब्यूटी 💄" },
  fashion: { label: "Fashion 👗", labelHi: "फ़ैशन 👗" },
  entertainment: { label: "Entertainment 🍿", labelHi: "मनोरंजन 🍿" },
};

// ---------------- Seamless switch-and-return launcher ----------------

type PendingReturn = { app: string; at: number };
let pendingReturnMem: PendingReturn | null = null;
const PENDING_KEY = "oniq:pendingMiniAppReturn";
const RETURN_WINDOW_MS = 30 * 60 * 1000;

function writePending(p: PendingReturn) {
  pendingReturnMem = p;
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage blocked — module var is enough */
  }
}

export function consumePendingReturn(): PendingReturn | null {
  let p: PendingReturn | null = pendingReturnMem;
  if (!p) {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (raw) p = JSON.parse(raw) as PendingReturn;
    } catch {
      /* ignore */
    }
  }
  pendingReturnMem = null;
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  if (!p) return null;
  if (Date.now() - p.at > RETURN_WINDOW_MS) return null;
  return p;
}

function isAndroid() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

async function isCapacitorNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import(/* @vite-ignore */ "@capacitor/core");
    return Capacitor.isNativePlatform?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Open a URL outside the Capacitor webview.
 * - Native: Capacitor Browser (Chrome Custom Tab) — honours Android app links,
 *   so https universal links like m.uber.com/ul/ launch the installed app.
 * - Web: opens in a new tab.
 */
export async function openInApp(url: string) {
  try {
    if (await isCapacitorNative()) {
      const mod = await import(/* @vite-ignore */ "@capacitor/browser");
      await mod.Browser.open({ url, presentationStyle: "popover", toolbarColor: "#0E0F13" });
      return;
    }
  } catch {
    /* fall through to web */
  }
  // Anchor click works even when window.open is blocked, and always opens
  // in a new tab so ONIQ never navigates away.
  try {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener,noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  } catch {
    /* ignore */
  }
  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (opened) return;
  } catch {
    /* ignore */
  }
  window.location.href = url;
}

/**
 * Web-only: try to launch a native app via its custom scheme (e.g. uber://).
 * Uses a hidden iframe + visibility change detection with a 1200ms timeout.
 * Resolves true if the app appears to have been opened (page went hidden),
 * false if the scheme handler didn't fire (app not installed).
 */
async function tryWebAppScheme(scheme: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  return new Promise((resolve) => {
    let done = false;
    const finish = (opened: boolean) => {
      if (done) return;
      done = true;
      document.removeEventListener("visibilitychange", onVis);
      try { iframe.remove(); } catch { /* ignore */ }
      resolve(opened);
    };
    const onVis = () => { if (document.hidden) finish(true); };
    document.addEventListener("visibilitychange", onVis);
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;left:-10000px;width:1px;height:1px;border:0;";
    iframe.src = scheme;
    try {
      document.body.appendChild(iframe);
    } catch {
      finish(false);
      return;
    }
    setTimeout(() => finish(document.hidden), 1200);
  });
}

/**
 * Launch a partner mini app.
 * - Native Android + androidPackage → intent:// with baked-in https fallback
 *   (OS opens the app when installed, otherwise Chrome opens the fallback).
 * - Native without a package → Chrome Custom Tab on the https URL.
 * - Web + appScheme → try scheme via hidden iframe, wait 1200ms, fall back to
 *   https in a new tab if the app didn't intercept.
 * - Web without appScheme → https in a new tab.
 * Any unrecoverable failure toasts and force-opens the https URL.
 */
export async function launchMiniApp(app: {
  name: string;
  url: string;
  androidPackage?: string;
  appScheme?: string;
}) {
  writePending({ app: app.name, at: Date.now() });
  if (typeof window === "undefined") return;
  try {
    const native = await isCapacitorNative();
    if (native) {
      if (isAndroid() && app.androidPackage) {
        const fallback = encodeURIComponent(app.url);
        const intent = `intent://#Intent;package=${app.androidPackage};S.browser_fallback_url=${fallback};end`;
        try {
          const mod: any = await import(/* @vite-ignore */ "@capacitor/app");
          await mod.App.openUrl({ url: intent });
          return;
        } catch {
          /* fall through to Custom Tab */
        }
      }
      await openInApp(app.url);
      return;
    }
    // Web path
    if (app.appScheme) {
      const opened = await tryWebAppScheme(app.appScheme);
      if (opened) return;
    }
    await openInApp(app.url);
  } catch {
    try {
      const { toast } = await import(/* @vite-ignore */ "sonner");
      toast("couldn't open that one 🤔 opening web instead");
    } catch { /* ignore */ }
    try { await openInApp(app.url); } catch { /* ignore */ }
  }
}



/** Fire an OS-level deep link (upi://, uber:// etc). Returns immediately. */
export function openDeepLink(url: string) {
  window.location.href = url;
}

/**
 * Launch a UPI intent so the OS resolves it to the user's UPI app
 * (GPay / PhonePe / Paytm / BHIM chooser on Android).
 * Native Capacitor: hand the URL to `@capacitor/app` App.openUrl — the
 * default Android WebViewClient silently rejects custom schemes on
 * <a href> clicks (`ERR_UNKNOWN_URL_SCHEME`), so we MUST go through
 * the OS intent system. Web: window.location.href.
 */
export async function launchUpiIntent(url: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const native = await isCapacitorNative();
    if (native) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mod: any = await import(/* @vite-ignore */ "@capacitor/app");
        await mod.App.openUrl({ url });
        return;
      } catch (err) {
        // openUrl throws when no app can handle the scheme.
        try {
          const { toast } = await import(/* @vite-ignore */ "sonner");
          toast.error("No UPI app installed — try Google Pay, PhonePe, or Paytm");
        } catch { /* ignore */ }
        console.warn("[upi] openUrl failed", err);
        return;
      }
    }
    // Web path — Chrome handles upi:// via the OS intent chooser.
    window.location.href = url;
  } catch (err) {
    console.warn("[upi] launch failed", err);
    try { window.location.href = url; } catch { /* ignore */ }
  }
}


// ---------------- UPI (NPCI standard intent) ----------------

export type UpiParams = {
  vpa: string; // payee UPI ID, e.g. name@okhdfcbank
  name: string; // payee display name
  amount?: number; // optional; user can enter in the UPI app
  note?: string;
};

function upiQuery({ vpa, name, amount, note }: UpiParams) {
  const q = new URLSearchParams();
  q.set("pa", vpa.trim());
  q.set("pn", name.trim() || vpa.trim());
  if (Number.isFinite(amount) && amount! > 0 && amount! <= 100000) q.set("am", amount!.toFixed(2));
  q.set("cu", "INR");
  if (note?.trim()) q.set("tn", note.trim().slice(0, 50));
  return q.toString();
}

/** Generic UPI intent — Android shows a chooser of all installed UPI apps. */
export function upiLink(p: UpiParams) {
  return `upi://pay?${upiQuery(p)}`;
}

/**
 * Payee-only intent for manual P2P sends. PhonePe (and others) decline
 * third-party intents that pre-fill an amount — "declined for security
 * reasons" — so the payer types the amount inside their own UPI app.
 */
export function upiPayeeLink({ vpa, name }: Pick<UpiParams, "vpa" | "name">) {
  const q = new URLSearchParams();
  q.set("pa", vpa.trim());
  q.set("pn", name.trim() || vpa.trim());
  q.set("cu", "INR");
  return `upi://pay?${q.toString()}`;
}

/** App-targeted UPI intents. */
export const UPI_APPS = [
  { id: "any", name: "Any UPI app", scheme: (p: UpiParams) => `upi://pay?${upiQuery(p)}`, color: "#00D4B8" },
  { id: "gpay", name: "Google Pay", scheme: (p: UpiParams) => `tez://upi/pay?${upiQuery(p)}`, color: "#4285F4", emoji: "💳" },
  { id: "phonepe", name: "PhonePe", scheme: (p: UpiParams) => `phonepe://pay?${upiQuery(p)}`, color: "#5F259F", emoji: "📲" },
  { id: "paytm", name: "Paytm", scheme: (p: UpiParams) => `paytmmp://pay?${upiQuery(p)}`, color: "#00BAF2", emoji: "💰" },
] as const;

export function isValidVpa(vpa: string) {
  return /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/.test(vpa.trim());
}

// ---------------- Ride deep links ----------------

export type RidePoint = { lat: number; lon: number; label: string };

/**
 * Uber universal link. Pickup defaults to the rider's current location
 * (supported natively via pickup=my_location per Uber's deep link docs).
 */
export function uberLink(drop: RidePoint, pickup?: RidePoint) {
  if (!Number.isFinite(drop.lat) || !Number.isFinite(drop.lon)) throw new Error("Invalid destination");
  const q = new URLSearchParams();
  q.set("action", "setPickup");
  if (pickup) {
    q.set("pickup[latitude]", String(pickup.lat));
    q.set("pickup[longitude]", String(pickup.lon));
    q.set("pickup[nickname]", pickup.label.slice(0, 60));
  } else {
    q.set("pickup", "my_location");
  }
  q.set("dropoff[latitude]", String(drop.lat));
  q.set("dropoff[longitude]", String(drop.lon));
  q.set("dropoff[nickname]", drop.label.slice(0, 60));
  return `https://m.uber.com/ul/?${q.toString()}`;
}

export function olaLink(drop: RidePoint, pickup?: RidePoint) {
  if (!Number.isFinite(drop.lat) || !Number.isFinite(drop.lon)) throw new Error("Invalid destination");
  const q = new URLSearchParams();
  q.set("serviceType", "p2p");
  q.set("utm_source", "oniq");
  if (pickup) {
    q.set("lat", String(pickup.lat));
    q.set("lng", String(pickup.lon));
  }
  q.set("drop_lat", String(drop.lat));
  q.set("drop_lng", String(drop.lon));
  return `https://book.olacabs.com/?${q.toString()}`;
}

// ---------------- Geocoding (Mappls primary, Nominatim fallback) ----------------

export type GeoResult = { lat: number; lon: number; label: string };

async function invokeMappls(payload: { op: "geocode" | "reverse" | "autosuggest"; query?: string; lat?: number; lon?: number; near?: string }): Promise<any | null> {
  try {
    const { supabase } = await import(/* @vite-ignore */ "@/integrations/supabase/client");
    const { data, error } = await supabase.functions.invoke("mappls-geo", { body: payload });
    if (error) { console.warn("[mappls-geo] invoke error", error?.message ?? error); return null; }
    return data;
  } catch (e) {
    console.warn("[mappls-geo] invoke threw", e);
    return null;
  }
}

async function nominatimGeocode(query: string): Promise<GeoResult[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error("Search failed");
  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  return rows
    .map((r) => ({
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      label: r.display_name.split(",").slice(0, 3).join(","),
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

export async function geocode(query: string): Promise<GeoResult[]> {
  const data = await invokeMappls({ op: "geocode", query });
  if (data?.source === "mappls" && Array.isArray(data.results) && data.results.length > 0) {
    return data.results as GeoResult[];
  }
  return nominatimGeocode(query);
}

/**
 * Mappls autosuggest — exported for future UI wiring. Silently falls back to
 * Nominatim forward search so callers always get something usable.
 */
export async function autosuggest(query: string, near?: { lat: number; lon: number }): Promise<GeoResult[]> {
  const data = await invokeMappls({ op: "autosuggest", query, lat: near?.lat, lon: near?.lon });
  if (data?.source === "mappls" && Array.isArray(data.results) && data.results.length > 0) {
    return data.results as GeoResult[];
  }
  return nominatimGeocode(query);
}

// ---------------- Ride Genie: routing + fare estimation ----------------

export type RouteInfo = { km: number; mins: number };

export async function getRoute(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<RouteInfo> {
  if (
    !Number.isFinite(from.lat) ||
    !Number.isFinite(from.lon) ||
    !Number.isFinite(to.lat) ||
    !Number.isFinite(to.lon)
  ) {
    throw new Error("Invalid coordinates");
  }
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Route service unavailable");
  const data = (await res.json()) as { routes?: Array<{ distance: number; duration: number }> };
  const r = data.routes?.[0];
  if (!r) throw new Error("No route found");
  return {
    km: Math.round((r.distance / 1000) * 10) / 10,
    mins: Math.ceil(r.duration / 60),
  };
}

export type RideOption = {
  providerId: "uber" | "ola" | "rapido-bike" | "rapido-auto";
  providerName: string;
  vehicle: string;
  color: string;
  fareLow: number;
  fareHigh: number;
  etaMins: number;
};

export function estimateRides(km: number, mins: number): RideOption[] {
  const models: Array<{
    providerId: RideOption["providerId"];
    providerName: string;
    vehicle: string;
    color: string;
    base: number;
  }> = [
    { providerId: "uber", providerName: "Uber", vehicle: "Uber Go", color: "#000000", base: 50 + 15 * km + 1.5 * mins },
    { providerId: "ola", providerName: "Ola", vehicle: "Ola Mini", color: "#3b7d0e", base: 55 + 14 * km + 1.5 * mins },
    { providerId: "rapido-bike", providerName: "Rapido", vehicle: "Bike", color: "#A67C00", base: 20 + 8 * km + 1.0 * mins },
    { providerId: "rapido-auto", providerName: "Rapido", vehicle: "Auto", color: "#A67C00", base: 30 + 11 * km + 1.25 * mins },
  ];
  return models
    .map((m) => ({
      providerId: m.providerId,
      providerName: m.providerName,
      vehicle: m.vehicle,
      color: m.color,
      fareLow: Math.round(m.base * 0.9),
      fareHigh: Math.round(m.base * 1.2),
      etaMins: mins,
    }))
    .sort((a, b) => a.fareLow - b.fareLow);
}

// ---------------- Phone GPS: native-first with browser fallback ----------------

export async function getCurrentLocation(): Promise<{ lat: number; lon: number }> {
  try {
    const mod: any = await import(/* @vite-ignore */ "@capacitor/geolocation");
    const Geolocation = mod.Geolocation;
    if (Geolocation) {
      try {
        await Geolocation.requestPermissions();
      } catch {
        // ignore — getCurrentPosition will surface a real failure
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      const lat = pos?.coords?.latitude;
      const lon = pos?.coords?.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
    }
  } catch {
    // native path unavailable — fall through to browser
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("location unavailable");
  }
  return await new Promise<{ lat: number; lon: number }>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => reject(new Error("location unavailable")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

async function nominatimReverse(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return "Your current location";
    const data = (await res.json()) as { display_name?: string };
    const dn = data?.display_name;
    if (!dn) return "Your current location";
    return dn.split(",").slice(0, 3).join(",").trim();
  } catch {
    return "Your current location";
  }
}

export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const data = await invokeMappls({ op: "reverse", lat, lon });
  if (data?.source === "mappls" && typeof data.label === "string" && data.label.trim()) {
    return data.label.trim();
  }
  return nominatimReverse(lat, lon);
}

export function relativeLuminance(hex: string): number {
  if (typeof hex !== "string") return 0;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return 0;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function readableInk(hex: string): string {
  return relativeLuminance(hex) > 0.179 ? "#0E0F13" : "#FFFFFF";
}
