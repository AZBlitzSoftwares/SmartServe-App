import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getPendingOrders, clearOrder } from '../lib/offlineQueue'
import WelcomeScreen from '../components/guest/WelcomeScreen'
import MenuScreen from '../components/guest/MenuScreen'
import CartDrawer from '../components/guest/CartDrawer'
import OrderStatus from '../components/guest/OrderStatus'
import SOSPanel from '../components/guest/SOSPanel'
import OrderHistory from '../components/guest/OrderHistory'

export default function GuestApp() {
  const { tableNumber } = useParams()
  const [screen, setScreen] = useState('welcome')
  const [cart, setCart] = useState([])
  const [currentOrderId, setCurrentOrderId] = useState(null)
  const [tableData, setTableData] = useState(null)
  const [eventData, setEventData] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showSOS, setShowSOS] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    loadEventAndTable()
    const handleOnline = () => { setIsOnline(true); syncOfflineOrders() }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [tableNumber])

  async function loadEventAndTable() {
    const { data: events } = await supabase.from('events').select('*').eq('is_closed', false).order('created_at', { ascending: false }).limit(1)
    if (!events?.length) return
    const event = events[0]
    setEventData(event)
    const { data: tables } = await supabase.from('tables').select('*').eq('event_id', event.id).eq('table_number', parseInt(tableNumber)).limit(1)
    if (tables?.length) setTableData(tables[0])
  }

  async function syncOfflineOrders() {
    const pending = await getPendingOrders()
    for (const order of pending) {
      try {
        const { data: newOrder } = await supabase.from('orders').insert({ event_id: order.event_id, table_id: order.table_id, status: 'pending' }).select().single()
        if (newOrder) {
          await supabase.from('order_items').insert(order.items.map(i => ({ order_id: newOrder.id, menu_item_id: i.id, quantity: i.quantity })))
          await clearOrder(order.id)
        }
      } catch(e) { console.error('Sync failed', e) }
    }
  }

  function addToCart(item) {
    setCart(prev => {
      const exists = prev.find(c => c.id === item.id)
      if (exists) return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  function removeFromCart(itemId) {
    setCart(prev => {
      const exists = prev.find(c => c.id === itemId)
      if (exists?.quantity === 1) return prev.filter(c => c.id !== itemId)
      return prev.map(c => c.id === itemId ? { ...c, quantity: c.quantity - 1 } : c)
    })
  }

  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', position: 'relative' }}>
      {screen === 'welcome' && <WelcomeScreen tableNumber={tableNumber} onStart={() => setScreen('menu')} eventData={eventData} />}
      {screen === 'menu' && (
        <MenuScreen
          tableData={tableData} eventData={eventData} tableNumber={tableNumber}
          cart={cart} addToCart={addToCart} removeFromCart={removeFromCart}
          cartCount={cartCount} isOnline={isOnline}
          onShowSOS={() => setShowSOS(true)}
          onShowHistory={() => setShowHistory(true)}
          onShowStatus={() => setScreen('status')}
          currentOrderId={currentOrderId}
        />
      )}
      {screen === 'status' && <OrderStatus orderId={currentOrderId} tableNumber={tableNumber} onBack={() => setScreen('menu')} />}
      {cartCount > 0 && screen === 'menu' && (
        <CartDrawer
          cart={cart} tableData={tableData} eventData={eventData} isOnline={isOnline}
          onOrderPlaced={(orderId) => { setCurrentOrderId(orderId); setCart([]); setScreen('status') }}
          onRemove={removeFromCart} onAdd={addToCart}
        />
      )}
      {showSOS && <SOSPanel tableData={tableData} eventData={eventData} onClose={() => setShowSOS(false)} />}
      {showHistory && <OrderHistory tableData={tableData} eventData={eventData} onClose={() => setShowHistory(false)} />}
    </div>
  )
}