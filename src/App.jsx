import { useState } from 'react'

function App() {
  const [status, setStatus] = useState({ message: 'Ready', isError: false })

  const updateStatus = (message, isError = false) => {
    setStatus({ message, isError })
  }

  const toggleFlashlight = async () => {
    try {
      const response = await fetch('/api/flashlight', {
        method: 'PUT',
        headers: {
          'Accept': '*/*'
        }
      })
      
      if (response.ok) {
        updateStatus('Light toggled successfully')
      } else {
        updateStatus(`Error: HTTP ${response.status}`, true)
      }
    } catch (error) {
      updateStatus(`Error: ${error.message}`, true)
    }
  }

  return (
    <div className="min-h-screen bg-base-200">
      <div className="container mx-auto p-4 max-w-4xl">
        <h1 className="text-4xl font-bold text-center mb-8 text-base-content">
          Coop Cam
        </h1>
        
        {/* Video Stream */}
        <div className="card bg-base-100 shadow-xl mb-6">
          <div className="card-body p-4">
            <img 
              src="http://localhost:8443/video" 
              alt="Live Stream" 
              className="w-full rounded-lg"
              style={{ maxHeight: '70vh', objectFit: 'contain' }}
            />
          </div>
        </div>
        
        {/* Control Panel */}
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title text-base-content">Controls</h2>
            <div className="card-actions justify-center mt-4">
              <button 
                className="btn btn-primary gap-2" 
                onClick={toggleFlashlight}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                </svg>
                Toggle Light
              </button>
            </div>
            <div className="mt-6">
              <div className={`alert ${status.isError ? 'alert-error' : 'alert-success'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span>{status.message}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App