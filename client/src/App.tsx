import { useState, useEffect } from 'react'
import axios from 'axios'

interface ProxyStats {
  isConnected: boolean
  clientCount: number
  sourceUrl: string
  hasLastFrame: boolean
  serverTime: string
}

export default function App() {
  const [status, setStatus] = useState('')
  const [statusType, setStatusType] = useState<'success' | 'error' | ''>('')
  const [proxyStats, setProxyStats] = useState<ProxyStats | null>(null)

  useEffect(() => {
    //apply theme
    document.documentElement.setAttribute('data-theme', 'caramellatte')
    
    //fetch initial stats
    fetchStats()
    
    //poll stats every 5 seconds
    const interval = setInterval(fetchStats, 5000)
    
    return () => clearInterval(interval)
  }, [])

  const fetchStats = async () => {
    try {
      const response = await axios.get('/api/stats')
      setProxyStats(response.data)
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }

  const toggleFlashlight = async () => {
    try {
      const response = await axios.put('/api/flashlight')
      setStatus(response.data.message || 'Flashlight toggled successfully')
      setStatusType('success')
      setTimeout(() => {
        setStatus('')
        setStatusType('')
      }, 3000)
    } catch (error) {
      setStatus('Failed to toggle flashlight')
      setStatusType('error')
      setTimeout(() => {
        setStatus('')
        setStatusType('')
      }, 3000)
    }
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-4">Coop Cam 🐔</h1>
      
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Live Feed</h2>
          
          {/* Video Stream */}
          <div className="relative">
            <img 
              src="/api/stream"
              alt="Live camera feed" 
              className="w-full max-h-96 object-contain rounded-lg"
            />
          </div>

          {/* Controls */}
          <div className="flex justify-between items-center mt-4">
            <button 
              onClick={toggleFlashlight}
              className="btn btn-primary"
            >
              <span className="text-lg">💡</span> Toggle Flashlight
            </button>

            {/* Current Viewers */}
            <div className="stat bg-base-300 rounded-box p-2">
              <div className="stat-title text-xs">Current Viewers</div>
              <div className="stat-value text-lg">{proxyStats?.clientCount || 0}</div>
            </div>
          </div>

          {/* Status Messages */}
          {status && (
            <div className={`alert ${statusType === 'success' ? 'alert-success' : 'alert-error'} mt-4`}>
              <span>{status}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}