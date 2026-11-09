import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppStoreProvider } from './app/AppStore'
import './styles.css'
import { installAndroidAPI } from './platform/android'

installAndroidAPI()

createRoot(document.getElementById('root')!).render(
  <StrictMode><AppStoreProvider><App /></AppStoreProvider></StrictMode>,
)
