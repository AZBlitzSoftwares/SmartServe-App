const fs = require('fs')
const BASE = '/Users/asayyed/SmartServe/src'

const cdPath = BASE + '/components/guest/CartDrawer.jsx'
let content = fs.readFileSync(cdPath, 'utf8')

// Replace the order limit message display
content = content.replace(
  `            {orderLimitMsg && (
              <div style={{ background:'#FEF3C7', border:'1px solid #FCD34D', borderRadius:12, padding:'14px 16px', fontSize:14, color:'#92400E', marginBottom:12, lineHeight:1.6, textAlign:'center' }}>
                <div style={{ fontSize:28, marginBottom:8 }}>🍽️</div>
                <div style={{ fontWeight:700, marginBottom:4 }}>Order in Progress!</div>
                {orderLimitMsg}
              </div>
            )}`,
  `            {orderLimitMsg && (
              <div style={{ background:'#FFF1F2', border:'2px solid #FDA4AF', borderRadius:16, padding:'18px 16px', marginBottom:12, textAlign:'center' }}>
                <div style={{ fontSize:36, marginBottom:10 }}>⏳</div>
                <div style={{ fontWeight:800, fontSize:16, color:'#BE123C', marginBottom:8 }}>
                  Please Wait for Your Current Order
                </div>
                <div style={{ fontSize:13, color:'#9F1239', lineHeight:1.7, marginBottom:12 }}>
                  Your previous order is still being prepared and delivered to your table.
                  You can place your next order as soon as it's delivered.
                </div>
                <div style={{ background:'#fff', borderRadius:10, padding:'10px 14px', border:'1.5px solid #FDA4AF' }}>
                  <div style={{ fontSize:12, color:'#BE123C', fontWeight:700, marginBottom:4 }}>✅ WHAT YOU CAN DO NOW</div>
                  <div style={{ fontSize:13, color:'#555', lineHeight:1.6 }}>
                    Browse the menu and add items to your cart.<br/>
                    Once your current order is delivered, just tap <strong>"Place Order"</strong> to confirm your next order.
                  </div>
                </div>
              </div>
            )}`
)

// Also disable the Place Order button when limit is reached
content = content.replace(
  `            <button
              onClick={handlePlaceOrder}
              disabled={placing}
              style={{`,
  `            <button
              onClick={orderLimitMsg ? undefined : handlePlaceOrder}
              disabled={placing || !!orderLimitMsg}
              style={{
                opacity: orderLimitMsg ? 0.4 : 1,
                cursor: orderLimitMsg ? 'not-allowed' : 'pointer',`
)

fs.writeFileSync(cdPath, content)
console.log('✅ CartDrawer — order limit message redesigned, button disabled')
console.log('Run: npm run dev')
