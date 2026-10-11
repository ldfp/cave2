import { useState, useEffect, useMemo, useRef } from 'react'
import localforage from 'localforage'
import dbData from './db.json'
import { compressImage } from './utils/imageUtils'
import { analyzeWineLabel } from './utils/aiAnalysis'
import { sendBackupToServer, fetchServerBackup, fetchServerStatus, exportBackupToFile } from './utils/backupService'
import './App.css'

const STORAGE_KEY = 'cave_bottles_v1'
const API_KEY_STORAGE = 'cave_gemini_api_key'
const LAST_BACKUP_STORAGE = 'cave_last_server_backup'

function App() {
  const [bottles, setBottles] = useState([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  // Server Backup State
  const [isSavingServer, setIsSavingServer] = useState(false)
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false)
  const [lastServerBackup, setLastServerBackup] = useState(() => {
    return localStorage.getItem(LAST_BACKUP_STORAGE) || null
  })

  // AI Configuration State
  const [geminiApiKey, setGeminiApiKey] = useState(() => {
    return localStorage.getItem(API_KEY_STORAGE) || import.meta.env.VITE_GEMINI_API_KEY || ''
  })
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [tempApiKey, setTempApiKey] = useState(geminiApiKey)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [autoAnalyzeOnUpload, setAutoAnalyzeOnUpload] = useState(true)

  // Form State
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [newBottle, setNewBottle] = useState({
    'Domaine / Propriété': '',
    'Cuvée / Style': '',
    'Appellation / IGP': '',
    'Région': '',
    'Type de vin': '',
    'Millésime': new Date().getFullYear(),
    'Quantité': 1,
    photo: null
  })
  const [formPhotoPreview, setFormPhotoPreview] = useState(null)
  const [aiSuccessBadge, setAiSuccessBadge] = useState(false)

  // Lightbox / Zoom State
  const [selectedPhotoBottle, setSelectedPhotoBottle] = useState(null)
  const [isZoomed, setIsZoomed] = useState(false)
  const [zoomOrigin, setZoomOrigin] = useState({ x: 50, y: 50 })

  // Status message (toast)
  const [toastMessage, setToastMessage] = useState(null)

  // Refs for file inputs per bottle
  const fileInputRefs = useRef({})
  const formFileInputRef = useRef(null)
  const lightboxFileInputRef = useRef(null)

  // Load initial data: prioritize Server Backup if available, then IndexedDB/localStorage
  useEffect(() => {
    const loadData = async () => {
      // 1. Try server backup first
      try {
        const serverData = await fetchServerBackup()
        if (serverData && Array.isArray(serverData.bottles) && serverData.bottles.length > 0) {
          const normalized = serverData.bottles.map(b => ({
            ...b,
            photo: b.photo || b.image || null
          }))
          setBottles(normalized)
          if (serverData.savedAt) {
            setLastServerBackup(serverData.savedAt)
            localStorage.setItem(LAST_BACKUP_STORAGE, serverData.savedAt)
          }
          setIsLoaded(true)
          return
        }
      } catch (serverErr) {
        // Normal if running purely static or server not created yet
      }

      // 2. Try client storage (IndexedDB)
      try {
        const stored = await localforage.getItem(STORAGE_KEY)
        if (stored && Array.isArray(stored) && stored.length > 0) {
          const normalized = stored.map(b => ({
            ...b,
            photo: b.photo || b.image || null
          }))
          setBottles(normalized)
          setIsLoaded(true)
          return
        }

        // Fallback localStorage
        const localSaved = localStorage.getItem(STORAGE_KEY)
        if (localSaved) {
          const parsed = JSON.parse(localSaved)
          if (Array.isArray(parsed) && parsed.length > 0) {
            setBottles(parsed.map(b => ({ ...b, photo: b.photo || b.image || null })))
            setIsLoaded(true)
            return
          }
        }
      } catch (err) {
        console.error('Erreur chargement données:', err)
      }

      // 3. Default initial from dbData
      const initialData = (dbData.bottles || []).map((b, index) => ({
        ...b,
        id: `initial-${index}`,
        photo: b.photo || b.image || null
      }))
      setBottles(initialData)
      setIsLoaded(true)
    }

    loadData()
  }, [])

  // Persist to client storage whenever bottles change
  useEffect(() => {
    if (!isLoaded) return

    const saveData = async () => {
      try {
        await localforage.setItem(STORAGE_KEY, bottles)
      } catch (err) {
        console.error('Erreur localforage:', err)
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bottles))
      } catch (err) {
        // Safe to ignore if quota reached, localforage persists the full dataset
      }
    }

    saveData()
  }, [bottles, isLoaded])

  const showToast = (msg) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage(null)
    }, 4000)
  }

  // Save to Server
  const handleSaveToServer = async () => {
    setIsSavingServer(true)
    try {
      const res = await sendBackupToServer(bottles)
      const saveDate = res.savedAt || new Date().toISOString()
      setLastServerBackup(saveDate)
      localStorage.setItem(LAST_BACKUP_STORAGE, saveDate)
      showToast(`💾 Sauvegarde réussie sur le serveur ! (${bottles.length} bouteilles & photos persistées)`)
    } catch (err) {
      console.error(err)
      showToast(`⚠️ Erreur sauvegarde serveur : ${err.message}. Export local proposé.`)
      setIsBackupModalOpen(true)
    } finally {
      setIsSavingServer(false)
    }
  }

  // Restore from Server
  const handleRestoreFromServer = async () => {
    try {
      const serverData = await fetchServerBackup()
      if (!serverData || !Array.isArray(serverData.bottles) || serverData.bottles.length === 0) {
        showToast("ℹ️ Aucune sauvegarde trouvée sur le serveur.")
        return
      }

      const normalized = serverData.bottles.map(b => ({
        ...b,
        photo: b.photo || b.image || null
      }))
      setBottles(normalized)
      if (serverData.savedAt) {
        setLastServerBackup(serverData.savedAt)
        localStorage.setItem(LAST_BACKUP_STORAGE, serverData.savedAt)
      }
      setIsBackupModalOpen(false)
      showToast(`🔄 Restauration réussie ! (${normalized.length} références rechargées depuis le serveur)`)
    } catch (err) {
      console.error(err)
      showToast(`❌ Impossible de restaurer : ${err.message}`)
    }
  }

  // Save API key
  const handleSaveApiKey = (e) => {
    e.preventDefault()
    const cleaned = tempApiKey.trim()
    setGeminiApiKey(cleaned)
    localStorage.setItem(API_KEY_STORAGE, cleaned)
    setIsSettingsOpen(false)
    showToast("🔑 Clé API Gemini enregistrée !")
  }

  // Options for filters
  const regions = useMemo(() => {
    const uniqueRegions = new Set(bottles.map(b => b['Région']).filter(Boolean))
    return Array.from(uniqueRegions).sort()
  }, [bottles])

  const types = useMemo(() => {
    const uniqueTypes = new Set(bottles.map(b => b['Type de vin']).filter(Boolean))
    return Array.from(uniqueTypes).sort()
  }, [bottles])

  // Filtered bottles
  const filteredBottles = useMemo(() => {
    return bottles.filter(bottle => {
      const matchesSearch = (
        (bottle['Domaine / Propriété'] || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (bottle['Cuvée / Style'] || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (bottle['Appellation / IGP'] || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
      const matchesRegion = regionFilter === '' || bottle['Région'] === regionFilter
      const matchesType = typeFilter === '' || bottle['Type de vin'] === typeFilter

      return matchesSearch && matchesRegion && matchesType
    })
  }, [bottles, searchQuery, regionFilter, typeFilter])

  const totalFilteredBottles = filteredBottles.reduce((sum, b) => sum + (Number(b['Quantité']) || 0), 0)
  const totalGlobalBottles = bottles.reduce((sum, b) => sum + (Number(b['Quantité']) || 0), 0)

  // AI Analysis Execution for Form
  const triggerAiAnalysis = async (imageDataUrl) => {
    if (!geminiApiKey) {
      setTempApiKey('')
      setIsSettingsOpen(true)
      showToast("⚠️ Veuillez renseigner votre clé API Gemini pour l'analyse IA.")
      return
    }

    setIsAnalyzing(true)
    setAiSuccessBadge(false)

    try {
      showToast("🤖 Analyse de l'étiquette en cours par l'IA...")
      const result = await analyzeWineLabel(imageDataUrl, geminiApiKey)

      setNewBottle(prev => ({
        ...prev,
        'Domaine / Propriété': result.domaine || prev['Domaine / Propriété'],
        'Cuvée / Style': result.cuvee || prev['Cuvée / Style'],
        'Région': result.region || prev['Région'],
        'Appellation / IGP': result.appellation || prev['Appellation / IGP'],
        'Type de vin': result.type || prev['Type de vin'],
        'Millésime': result.millesime || prev['Millésime']
      }))

      setAiSuccessBadge(true)
      showToast("✨ Étiquette analysée ! Les champs ont été pré-remplis.")
    } catch (err) {
      console.error(err)
      showToast(`❌ Erreur IA : ${err.message || "Analyse impossible"}`)
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Handle Photo Upload on an existing bottle
  const handlePhotoFileChange = async (bottleId, e) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const compressedDataUrl = await compressImage(file)
      setBottles(prev =>
        prev.map(b => {
          if (b.id === bottleId) {
            return { ...b, photo: compressedDataUrl, image: compressedDataUrl }
          }
          return b
        })
      )
      if (selectedPhotoBottle && selectedPhotoBottle.id === bottleId) {
        setSelectedPhotoBottle(prev => ({ ...prev, photo: compressedDataUrl, image: compressedDataUrl }))
      }
      showToast('📸 Photo haute définition enregistrée ! Pensez à cliquer sur "Sauvegarder sur le serveur".')
    } catch (err) {
      console.error(err)
      showToast('❌ Erreur lors du chargement de la photo.')
    } finally {
      e.target.value = ''
    }
  }

  // AI Analysis for an existing bottle from Lightbox
  const handleAnalyzeExistingBottle = async (bottle) => {
    const img = bottle.photo || bottle.image
    if (!img) return

    if (!geminiApiKey) {
      setTempApiKey('')
      setIsSettingsOpen(true)
      showToast("⚠️ Veuillez configurer votre clé API Gemini.")
      return
    }

    setIsAnalyzing(true)
    try {
      showToast("🤖 Analyse de l'étiquette en cours...")
      const result = await analyzeWineLabel(img, geminiApiKey)

      const updatedBottle = {
        ...bottle,
        'Domaine / Propriété': result.domaine || bottle['Domaine / Propriété'],
        'Cuvée / Style': result.cuvee || bottle['Cuvée / Style'],
        'Région': result.region || bottle['Région'],
        'Appellation / IGP': result.appellation || bottle['Appellation / IGP'],
        'Type de vin': result.type || bottle['Type de vin'],
        'Millésime': result.millesime || bottle['Millésime']
      }

      setBottles(prev => prev.map(b => b.id === bottle.id ? updatedBottle : b))
      setSelectedPhotoBottle(updatedBottle)
      showToast("✨ Bouteille mise à jour avec les informations de l'étiquette !")
    } catch (err) {
      console.error(err)
      showToast(`❌ Erreur IA : ${err.message}`)
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Remove photo from bottle
  const handleRemovePhoto = (bottleId, e) => {
    if (e) e.stopPropagation()
    setBottles(prev =>
      prev.map(b => {
        if (b.id === bottleId) {
          return { ...b, photo: null, image: null }
        }
        return b
      })
    )
    if (selectedPhotoBottle && selectedPhotoBottle.id === bottleId) {
      setSelectedPhotoBottle(prev => ({ ...prev, photo: null, image: null }))
    }
    showToast('🗑️ Photo supprimée')
  }

  // Trigger file dialog for a specific bottle
  const triggerFileInput = (bottleId, e) => {
    if (e) e.stopPropagation()
    const input = fileInputRefs.current[bottleId]
    if (input) {
      input.click()
    }
  }

  // Handle Photo selection in Add Form
  const handleFormPhotoChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const compressedDataUrl = await compressImage(file)
      setFormPhotoPreview(compressedDataUrl)
      setNewBottle(prev => ({ ...prev, photo: compressedDataUrl, image: compressedDataUrl }))

      if (autoAnalyzeOnUpload) {
        triggerAiAnalysis(compressedDataUrl)
      }
    } catch (err) {
      console.error(err)
      showToast("❌ Impossible de charger l'image.")
    }
  }

  const handleClearFormPhoto = () => {
    setFormPhotoPreview(null)
    setAiSuccessBadge(false)
    setNewBottle(prev => ({ ...prev, photo: null, image: null }))
    if (formFileInputRef.current) {
      formFileInputRef.current.value = ''
    }
  }

  const handleAddBottle = (e) => {
    e.preventDefault()
    const bottleToAdd = {
      ...newBottle,
      id: `added-${Date.now()}`
    }
    setBottles([bottleToAdd, ...bottles])
    setIsFormOpen(false)
    setNewBottle({
      'Domaine / Propriété': '',
      'Cuvée / Style': '',
      'Appellation / IGP': '',
      'Région': '',
      'Type de vin': '',
      'Millésime': new Date().getFullYear(),
      'Quantité': 1,
      photo: null
    })
    setFormPhotoPreview(null)
    setAiSuccessBadge(false)
    showToast('✨ Bouteille ajoutée ! Pensez à cliquer sur "Sauvegarder sur le serveur".')
  }

  const handleFormChange = (field, value) => {
    setNewBottle(prev => ({ ...prev, [field]: value }))
  }

  const handleUpdateQuantity = (id, delta, e) => {
    if (e) e.stopPropagation()
    setBottles(prevBottles =>
      prevBottles.map(bottle => {
        if (bottle.id === id) {
          const newQty = Math.max(0, (Number(bottle['Quantité']) || 0) + delta)
          return { ...bottle, 'Quantité': newQty }
        }
        return bottle
      })
    )
  }

  const getWineColorTheme = (type) => {
    const t = (type || '').toLowerCase()
    if (t.includes('rouge')) return 'theme-rouge'
    if (t.includes('blanc')) return 'theme-blanc'
    if (t.includes('rosé') || t.includes('rose')) return 'theme-rose'
    if (t.includes('champagne') || t.includes('bulles') || t.includes('pétillant') || t.includes('cremant') || t.includes('crémant')) return 'theme-bulles'
    return 'theme-autre'
  }

  // Interactive zoom handlers
  const handleImageMouseMove = (e) => {
    if (!isZoomed) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
    setZoomOrigin({ x, y })
  }

  const openLightbox = (bottle) => {
    setSelectedPhotoBottle(bottle)
    setIsZoomed(false)
  }

  const formatLastBackupDate = (isoStr) => {
    if (!isoStr) return 'Aucune sauvegarde effectuée'
    try {
      const d = new Date(isoStr)
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch (e) {
      return isoStr
    }
  }

  return (
    <div className="app-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-notification">
          {toastMessage}
        </div>
      )}

      <header>
        <div className="header-title-box">
          <h1 className="gradient-text">Gestion de ma cave</h1>
          <p className="subtitle">Visualisez, personnalisez et gérez votre collection de vins</p>
          {lastServerBackup && (
            <span className="backup-timestamp-badge" onClick={() => setIsBackupModalOpen(true)} title="Cliquez pour gérer les sauvegardes">
              💾 Serveur synchronisé : {formatLastBackupDate(lastServerBackup)}
            </span>
          )}
        </div>
        <div className="header-actions">
          {/* Main Save to Server Button */}
          <button 
            className="save-server-btn" 
            onClick={handleSaveToServer}
            disabled={isSavingServer}
            title="Envoyer une sauvegarde complète de vos bouteilles et photos sur votre serveur 192.168.1.12"
          >
            {isSavingServer ? (
              <>⏳ Sauvegarde en cours...</>
            ) : (
              <>💾 Sauvegarder sur le serveur</>
            )}
          </button>

          <button 
            className="backup-options-btn" 
            onClick={() => setIsBackupModalOpen(true)}
            title="Options de sauvegarde et restauration"
          >
            ⚙️ Sauvegardes
          </button>

          <button 
            className="settings-btn" 
            onClick={() => {
              setTempApiKey(geminiApiKey)
              setIsSettingsOpen(true)
            }}
            title="Configuration IA (Clé API Gemini)"
          >
            🤖 {geminiApiKey ? 'IA Active ✨' : 'Configurer IA'}
          </button>

          <button className="add-btn" onClick={() => setIsFormOpen(true)}>
            <span className="btn-icon">+</span> Ajouter une bouteille
          </button>
        </div>
      </header>

      <main>
        <div className="dashboard">
          <div className="stat-card glass-panel">
            <span className="label">Bouteilles Filtrées</span>
            <span className="value">{totalFilteredBottles}</span>
          </div>
          <div className="stat-card glass-panel">
            <span className="label">Références Affichées</span>
            <span className="value">{filteredBottles.length}</span>
          </div>
          <div className="stat-card glass-panel">
            <span className="label">Total (Global)</span>
            <span className="value">{totalGlobalBottles}</span>
          </div>
        </div>

        <section className="recent-bottles glass-panel">
          <div className="section-header">
            <h2>Mon Inventaire</h2>
            <span className="hint-pill">💡 Cliquez sur "Sauvegarder sur le serveur" pour garder vos données et photos à l'abri</span>
          </div>
          
          <div className="filters-container">
            <div className="search-wrapper">
              <span className="search-icon">🔍</span>
              <input 
                type="text" 
                className="search-input" 
                placeholder="Rechercher un domaine, une cuvée, une appellation..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="clear-search-btn" onClick={() => setSearchQuery('')}>×</button>
              )}
            </div>
            
            <select 
              className="filter-select"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
            >
              <option value="">Toutes les régions</option>
              {regions.map(region => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>

            <select 
              className="filter-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">Tous les types</option>
              {types.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="bottle-list">
            {filteredBottles.length > 0 ? (
              filteredBottles.map((bottle) => {
                const colorTheme = getWineColorTheme(bottle['Type de vin'])
                const bottleImg = bottle.photo || bottle.image

                return (
                  <div key={bottle.id} className={`bottle-item ${colorTheme}`}>
                    {/* Hidden file input for this bottle */}
                    <input 
                      type="file" 
                      accept="image/*"
                      ref={(el) => (fileInputRefs.current[bottle.id] = el)}
                      style={{ display: 'none' }}
                      onChange={(e) => handlePhotoFileChange(bottle.id, e)}
                    />

                    {/* Bottle Photo Container - Tall bottle portrait format */}
                    <div 
                      className={`bottle-photo-container ${bottleImg ? 'has-photo' : 'no-photo'}`}
                      onClick={(e) => {
                        if (bottleImg) {
                          openLightbox(bottle)
                        } else {
                          triggerFileInput(bottle.id, e)
                        }
                      }}
                      title={bottleImg ? "Cliquez pour agrandir et lire l'étiquette" : "Cliquez pour ajouter une photo"}
                    >
                      {bottleImg ? (
                        <>
                          <img 
                            src={bottleImg} 
                            alt={bottle['Domaine / Propriété']} 
                            className="bottle-photo-img" 
                          />
                          <div className="photo-hover-overlay">
                            <span className="overlay-btn zoom-btn" title="Agrandir">🔍</span>
                            <span 
                              className="overlay-btn replace-btn" 
                              title="Remplacer la photo"
                              onClick={(e) => triggerFileInput(bottle.id, e)}
                            >📷</span>
                          </div>
                        </>
                      ) : (
                        <div className="bottle-placeholder-box">
                          <svg className="wine-bottle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.75h4.5m-4.5 0v3.25l-2.25 4.5v8.75a1.5 1.5 0 001.5 1.5h7.5a1.5 1.5 0 001.5-1.5v-8.75l-2.25-4.5V3.75m-6 0h6m-5.25 6h4.5" />
                          </svg>
                          <span className="add-photo-tag">+ Photo</span>
                        </div>
                      )}
                    </div>

                    {/* Bottle Information */}
                    <div className="bottle-info">
                      <div className="bottle-title-row">
                        <span className="bottle-name">
                          {bottle['Domaine / Propriété']} 
                          {bottle['Cuvée / Style'] ? ` • ${bottle['Cuvée / Style']}` : ''}
                        </span>
                      </div>
                      
                      <div className="bottle-meta-row">
                        <span className="meta-badge appellation-badge">
                          {bottle['Appellation / IGP'] || 'Appellation non spécifiée'}
                        </span>
                        <span className="meta-badge region-badge">
                          📍 {bottle['Région'] || 'Région libre'}
                        </span>
                        <span className={`meta-badge type-badge ${colorTheme}`}>
                          🍷 {bottle['Type de vin'] || 'Non classé'}
                        </span>
                      </div>

                      {/* Quick Photo Actions */}
                      <div className="bottle-quick-actions">
                        <button 
                          type="button" 
                          className="quick-photo-btn"
                          onClick={(e) => triggerFileInput(bottle.id, e)}
                        >
                          📷 {bottleImg ? 'Remplacer la photo' : 'Ajouter une photo'}
                        </button>
                        {bottleImg && (
                          <>
                            <button 
                              type="button" 
                              className="quick-photo-btn view-btn"
                              onClick={() => openLightbox(bottle)}
                            >
                              🔍 Agrandir l'étiquette
                            </button>
                            <button 
                              type="button" 
                              className="quick-remove-photo-btn"
                              onClick={(e) => handleRemovePhoto(bottle.id, e)}
                              title="Supprimer la photo actuelle"
                            >
                              🗑️ Supprimer
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right column: Millésime and Quantité controls */}
                    <div className="bottle-right-col">
                      <div className="bottle-year-box">
                        <span className="year-label">Millésime</span>
                        <span className="bottle-year">{bottle['Millésime'] || '—'}</span>
                      </div>
                      
                      <div className="qty-wrapper">
                        <span className="qty-label">Stock :</span>
                        <div className="qty-controls">
                          <button 
                            className="qty-btn" 
                            onClick={(e) => handleUpdateQuantity(bottle.id, -1, e)}
                            disabled={bottle['Quantité'] <= 0}
                            title="Diminuer"
                          >-</button>
                          <span className="qty-value">{bottle['Quantité']}</span>
                          <button 
                            className="qty-btn" 
                            onClick={(e) => handleUpdateQuantity(bottle.id, 1, e)}
                            title="Augmenter"
                          >+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="empty-state">
                <p>Aucune bouteille ne correspond à vos critères de recherche.</p>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Lightbox / High-Resolution Zoom Modal */}
      {selectedPhotoBottle && (
        <div className="modal-overlay" onClick={() => setSelectedPhotoBottle(null)}>
          <div className="modal-content lightbox-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedPhotoBottle(null)}>&times;</button>
            
            <div className="lightbox-body">
              <div className="lightbox-image-section">
                <div 
                  className={`lightbox-image-container ${isZoomed ? 'zoomed' : ''}`}
                  onMouseMove={handleImageMouseMove}
                  onClick={() => setIsZoomed(!isZoomed)}
                  title={isZoomed ? "Cliquez pour dézoomer" : "Cliquez ou survolez pour zoomer sur les détails de l'étiquette"}
                >
                  {(selectedPhotoBottle.photo || selectedPhotoBottle.image) ? (
                    <img 
                      src={selectedPhotoBottle.photo || selectedPhotoBottle.image} 
                      alt={selectedPhotoBottle['Domaine / Propriété']} 
                      className="lightbox-img"
                      style={
                        isZoomed
                          ? {
                              transform: 'scale(2.4)',
                              transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                              cursor: 'zoom-out'
                            }
                          : { cursor: 'zoom-in' }
                      }
                    />
                  ) : (
                    <div className="lightbox-no-image">
                      <span>Aucune photo</span>
                    </div>
                  )}

                  {/* Zoom hint badge */}
                  {(selectedPhotoBottle.photo || selectedPhotoBottle.image) && (
                    <div className="zoom-hint-badge">
                      {isZoomed ? '🔍 Mode Zoom x2.4 actif (déplacez la souris)' : '🔍 Cliquez sur l\'image pour zoomer sur l\'étiquette'}
                    </div>
                  )}
                </div>

                {/* Zoom controls */}
                {(selectedPhotoBottle.photo || selectedPhotoBottle.image) && (
                  <div className="zoom-controls-bar">
                    <button 
                      type="button" 
                      className={`zoom-toggle-btn ${isZoomed ? 'active' : ''}`}
                      onClick={() => setIsZoomed(!isZoomed)}
                    >
                      {isZoomed ? '🔎 Réinitialiser le zoom (1x)' : '🔍 Zoomer sur l\'étiquette (x2.4)'}
                    </button>
                  </div>
                )}
              </div>

              <div className="lightbox-details">
                <div>
                  <h3>{selectedPhotoBottle['Domaine / Propriété']}</h3>
                  {selectedPhotoBottle['Cuvée / Style'] && (
                    <p className="lightbox-cuvee">{selectedPhotoBottle['Cuvée / Style']}</p>
                  )}
                  
                  <div className="lightbox-info-list">
                    <div><strong>Millésime :</strong> {selectedPhotoBottle['Millésime'] || 'Non précisé'}</div>
                    <div><strong>Appellation :</strong> {selectedPhotoBottle['Appellation / IGP'] || '—'}</div>
                    <div><strong>Région :</strong> {selectedPhotoBottle['Région'] || '—'}</div>
                    <div><strong>Type de vin :</strong> {selectedPhotoBottle['Type de vin'] || '—'}</div>
                    <div><strong>Stock en cave :</strong> {selectedPhotoBottle['Quantité']} bouteille(s)</div>
                  </div>
                </div>

                {/* Hidden input in lightbox */}
                <input 
                  type="file" 
                  accept="image/*"
                  ref={lightboxFileInputRef}
                  style={{ display: 'none' }}
                  onChange={(e) => handlePhotoFileChange(selectedPhotoBottle.id, e)}
                />

                <div className="lightbox-actions">
                  <button 
                    type="button" 
                    className="ai-analyze-btn"
                    onClick={() => handleAnalyzeExistingBottle(selectedPhotoBottle)}
                    disabled={isAnalyzing}
                  >
                    {isAnalyzing ? '⏳ Analyse IA en cours...' : '✨ Réanalyser cette étiquette avec l\'IA'}
                  </button>

                  <button 
                    type="button" 
                    className="add-btn lightbox-replace-btn"
                    onClick={() => lightboxFileInputRef.current?.click()}
                  >
                    📷 Remplacer cette photo
                  </button>

                  {(selectedPhotoBottle.photo || selectedPhotoBottle.image) && (
                    <button 
                      type="button" 
                      className="btn-danger-outline"
                      onClick={() => handleRemovePhoto(selectedPhotoBottle.id)}
                    >
                      🗑️ Supprimer la photo
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Backup & Remanence Modal */}
      {isBackupModalOpen && (
        <div className="modal-overlay" onClick={() => setIsBackupModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setIsBackupModalOpen(false)}>&times;</button>
            <h2>Gestion des Sauvegardes & Rémanence</h2>
            <p className="settings-desc">
              Sauvegardez l'intégralité de vos bouteilles et photos directement sur le disque dur de votre serveur (192.168.1.12). 
              Vos données restent persistées en permanence, même si vous videz l'historique de votre navigateur ou changez d'appareil.
            </p>

            <div className="backup-modal-status-box">
              <div className="backup-status-row">
                <span className="backup-status-label">Dernière sauvegarde serveur :</span>
                <span className="backup-status-value">{formatLastBackupDate(lastServerBackup)}</span>
              </div>
              <div className="backup-status-row">
                <span className="backup-status-label">Bouteilles en mémoire :</span>
                <span className="backup-status-value">{bottles.length} référence(s)</span>
              </div>
            </div>

            <div className="backup-modal-actions-list">
              <button 
                type="button" 
                className="btn-backup-action primary"
                disabled={isSavingServer}
                onClick={async () => {
                  await handleSaveToServer()
                  setIsBackupModalOpen(false)
                }}
              >
                {isSavingServer ? '⏳ Sauvegarde sur le serveur en cours...' : '💾 Sauvegarder sur le serveur maintenant'}
              </button>

              <button 
                type="button" 
                className="btn-backup-action secondary"
                onClick={handleRestoreFromServer}
              >
                🔄 Restaurer depuis la sauvegarde du serveur
              </button>

              <button 
                type="button" 
                className="btn-backup-action outline"
                onClick={() => {
                  exportBackupToFile(bottles)
                  showToast("📥 Fichier de secours exporté sur votre appareil !")
                }}
              >
                📥 Télécharger une archive locale (.JSON de secours)
              </button>
            </div>

            <div className="form-actions">
              <button type="button" className="btn-cancel" onClick={() => setIsBackupModalOpen(false)}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal (Gemini API Key) */}
      {isSettingsOpen && (
        <div className="modal-overlay" onClick={() => setIsSettingsOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setIsSettingsOpen(false)}>&times;</button>
            <h2>Configuration de l'IA (Vision)</h2>
            <p className="settings-desc">
              L'analyse automatique d'étiquettes utilise <strong>Google Gemini Vision</strong> pour identifier avec précision le domaine, la cuvée, l'appellation, la région et le millésime.
            </p>

            <form onSubmit={handleSaveApiKey} style={{ marginTop: '1.5rem' }}>
              <div className="form-group">
                <label>Clé API Google Gemini (Gratuite)</label>
                <input 
                  type="password" 
                  placeholder="Collez votre clé API (ex: AIzaSy...)"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="api-key-help-box">
                <p>💡 <strong>Vous n'avez pas encore de clé API ?</strong></p>
                <p>Elle s'obtient <strong>gratuitement en 30 secondes</strong> sur Google AI Studio :</p>
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="api-key-link"
                >
                  👉 Obtenir ma clé API Gemini gratuite sur Google AI Studio ↗
                </a>
              </div>

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setIsSettingsOpen(false)}>Fermer</button>
                <button type="submit" className="add-btn">Enregistrer la clé</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal d'ajout de nouvelle bouteille */}
      {isFormOpen && (
        <div className="modal-overlay" onClick={() => setIsFormOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setIsFormOpen(false)}>&times;</button>
            <h2>Nouvelle Bouteille</h2>
            <form onSubmit={handleAddBottle}>
              {/* Photo Upload & AI Analysis in Add Form */}
              <div className="form-group form-photo-upload-group">
                <div className="photo-label-row">
                  <label>Photo de la bouteille (ou prise de photo smartphone)</label>
                  <label className="auto-ai-toggle">
                    <input 
                      type="checkbox" 
                      checked={autoAnalyzeOnUpload}
                      onChange={(e) => setAutoAnalyzeOnUpload(e.target.checked)}
                    />
                    <span>Analyse IA auto</span>
                  </label>
                </div>

                <div className="form-photo-upload-container">
                  {formPhotoPreview ? (
                    <div className="form-photo-preview-box">
                      <img src={formPhotoPreview} alt="Aperçu" className="form-photo-preview-img" />
                      <div className="form-photo-actions">
                        <button 
                          type="button" 
                          className="ai-trigger-btn"
                          disabled={isAnalyzing}
                          onClick={() => triggerAiAnalysis(formPhotoPreview)}
                        >
                          {isAnalyzing ? '⏳ Analyse en cours...' : '✨ Analyser l\'étiquette avec l\'IA'}
                        </button>
                        
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button 
                            type="button" 
                            className="btn-sm"
                            onClick={() => formFileInputRef.current?.click()}
                          >
                            Changer
                          </button>
                          <button 
                            type="button" 
                            className="btn-sm btn-danger"
                            onClick={handleClearFormPhoto}
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div 
                      className="form-photo-dropzone"
                      onClick={() => formFileInputRef.current?.click()}
                    >
                      <span className="dropzone-icon">📷</span>
                      <span className="dropzone-main-text">Prenez en photo ou choisissez l'étiquette</span>
                      <small className="dropzone-hint">✨ Les caractéristiques (Domaine, Appellation, Millésime...) seront complétées automatiquement</small>
                    </div>
                  )}
                  <input 
                    type="file" 
                    accept="image/*"
                    ref={formFileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFormPhotoChange}
                  />
                </div>

                {/* AI Status / Success Badge */}
                {isAnalyzing && (
                  <div className="ai-status-pulse">
                    <span className="pulse-dot"></span>
                    <span>Analyse oenologique par l'IA en cours... Extraction des mentions de l'étiquette</span>
                  </div>
                )}

                {aiSuccessBadge && (
                  <div className="ai-success-banner">
                    ✨ <strong>Informations extraites par l'IA !</strong> Les champs ci-dessous ont été complétés. Vous pouvez les ajuster si nécessaire.
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Domaine / Propriété *</label>
                <input 
                  type="text" 
                  required
                  placeholder="Ex: Champagne Francis Cossy"
                  value={newBottle['Domaine / Propriété']} 
                  onChange={(e) => handleFormChange('Domaine / Propriété', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Cuvée / Style</label>
                <input 
                  type="text" 
                  placeholder="Ex: Brut Premier Cru"
                  value={newBottle['Cuvée / Style']} 
                  onChange={(e) => handleFormChange('Cuvée / Style', e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 150px' }}>
                  <label>Région</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Champagne"
                    value={newBottle['Région']} 
                    onChange={(e) => handleFormChange('Région', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: '1 1 150px' }}>
                  <label>Appellation / IGP</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Champagne AOC"
                    value={newBottle['Appellation / IGP']} 
                    onChange={(e) => handleFormChange('Appellation / IGP', e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 150px' }}>
                  <label>Type de vin</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Champagne / Pétillant, Rouge, Blanc sec..."
                    value={newBottle['Type de vin']} 
                    onChange={(e) => handleFormChange('Type de vin', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ width: '120px' }}>
                  <label>Millésime</label>
                  <input 
                    type="text" 
                    value={newBottle['Millésime']} 
                    onChange={(e) => handleFormChange('Millésime', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ width: '90px' }}>
                  <label>Quantité *</label>
                  <input 
                    type="number" 
                    min="1"
                    required
                    value={newBottle['Quantité']} 
                    onChange={(e) => handleFormChange('Quantité', Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setIsFormOpen(false)}>Annuler</button>
                <button type="submit" className="add-btn">Sauvegarder</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
