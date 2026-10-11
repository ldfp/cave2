import { useState, useEffect, useMemo, useRef } from 'react'
import localforage from 'localforage'
import dbData from './db.json'
import { compressImage } from './utils/imageUtils'
import './App.css'

const STORAGE_KEY = 'cave_bottles_v1'

function App() {
  const [bottles, setBottles] = useState([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

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

  // Lightbox / Zoom State
  const [selectedPhotoBottle, setSelectedPhotoBottle] = useState(null)

  // Status message (toast)
  const [toastMessage, setToastMessage] = useState(null)

  // Refs for file inputs per bottle
  const fileInputRefs = useRef({})
  const formFileInputRef = useRef(null)
  const lightboxFileInputRef = useRef(null)

  // Load initial data from localforage / localStorage or db.json
  useEffect(() => {
    const loadData = async () => {
      try {
        const stored = await localforage.getItem(STORAGE_KEY)
        if (stored && Array.isArray(stored) && stored.length > 0) {
          // Normalize photo / image fields
          const normalized = stored.map(b => ({
            ...b,
            photo: b.photo || b.image || null
          }))
          setBottles(normalized)
          setIsLoaded(true)
          return
        }

        // Check fallback in localStorage
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
        console.error('Erreur chargement données stockées:', err)
      }

      // Default initial from dbData
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

  // Persist whenever bottles change after initial load
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
        // LocalStorage may exceed quota if photos are very large; localforage handles it
      }
    }

    saveData()
  }, [bottles, isLoaded])

  const showToast = (msg) => {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage(null)
    }, 3000)
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
      showToast('📸 Photo enregistrée avec succès !')
    } catch (err) {
      console.error(err)
      showToast('❌ Erreur lors du chargement de la photo.')
    } finally {
      e.target.value = ''
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
    } catch (err) {
      console.error(err)
      showToast("❌ Impossible de charger l'image.")
    }
  }

  const handleClearFormPhoto = () => {
    setFormPhotoPreview(null)
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
    showToast('✨ Bouteille ajoutée au catalogue !')
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
        </div>
        <button className="add-btn" onClick={() => setIsFormOpen(true)}>
          <span className="btn-icon">+</span> Ajouter une bouteille
        </button>
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
            <span className="hint-pill">💡 Cliquez sur la photo d'une bouteille pour la modifier ou l'agrandir</span>
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

                    {/* Bottle Photo / Thumbnail Section */}
                    <div 
                      className={`bottle-photo-container ${bottleImg ? 'has-photo' : 'no-photo'}`}
                      onClick={(e) => {
                        if (bottleImg) {
                          setSelectedPhotoBottle(bottle)
                        } else {
                          triggerFileInput(bottle.id, e)
                        }
                      }}
                      title={bottleImg ? "Cliquez pour agrandir ou remplacer" : "Cliquez pour ajouter une photo"}
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
                          <button 
                            type="button" 
                            className="quick-remove-photo-btn"
                            onClick={(e) => handleRemovePhoto(bottle.id, e)}
                            title="Supprimer la photo actuelle"
                          >
                            🗑️ Supprimer la photo
                          </button>
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

      {/* Lightbox / Zoom Modal */}
      {selectedPhotoBottle && (
        <div className="modal-overlay" onClick={() => setSelectedPhotoBottle(null)}>
          <div className="modal-content lightbox-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedPhotoBottle(null)}>&times;</button>
            
            <div className="lightbox-body">
              <div className="lightbox-image-container">
                {(selectedPhotoBottle.photo || selectedPhotoBottle.image) ? (
                  <img 
                    src={selectedPhotoBottle.photo || selectedPhotoBottle.image} 
                    alt={selectedPhotoBottle['Domaine / Propriété']} 
                    className="lightbox-img"
                  />
                ) : (
                  <div className="lightbox-no-image">
                    <span>Aucune photo</span>
                  </div>
                )}
              </div>

              <div className="lightbox-details">
                <h3>{selectedPhotoBottle['Domaine / Propriété']}</h3>
                {selectedPhotoBottle['Cuvée / Style'] && (
                  <p className="lightbox-cuvee">{selectedPhotoBottle['Cuvée / Style']}</p>
                )}
                
                <div className="lightbox-info-list">
                  <div><strong>Millésime :</strong> {selectedPhotoBottle['Millésime'] || 'Non précisé'}</div>
                  <div><strong>Appellation :</strong> {selectedPhotoBottle['Appellation / IGP'] || '—'}</div>
                  <div><strong>Région :</strong> {selectedPhotoBottle['Région'] || '—'}</div>
                  <div><strong>Type :</strong> {selectedPhotoBottle['Type de vin'] || '—'}</div>
                  <div><strong>Stock actuel :</strong> {selectedPhotoBottle['Quantité']} bouteille(s)</div>
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

      {/* Modal d'ajout de nouvelle bouteille */}
      {isFormOpen && (
        <div className="modal-overlay" onClick={() => setIsFormOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setIsFormOpen(false)}>&times;</button>
            <h2>Nouvelle Bouteille</h2>
            <form onSubmit={handleAddBottle}>
              {/* Photo Upload in Add Form */}
              <div className="form-group form-photo-upload-group">
                <label>Photo de la bouteille (optionnel)</label>
                <div className="form-photo-upload-container">
                  {formPhotoPreview ? (
                    <div className="form-photo-preview-box">
                      <img src={formPhotoPreview} alt="Aperçu" className="form-photo-preview-img" />
                      <div className="form-photo-actions">
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
                  ) : (
                    <div 
                      className="form-photo-dropzone"
                      onClick={() => formFileInputRef.current?.click()}
                    >
                      <span className="dropzone-icon">📷</span>
                      <span>Cliquez pour choisir une photo de la bouteille</span>
                      <small className="dropzone-hint">Format JPEG ou PNG (automatiquement optimisé)</small>
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
              </div>

              <div className="form-group">
                <label>Domaine / Propriété *</label>
                <input 
                  type="text" 
                  required
                  placeholder="Ex: Château Margaux"
                  value={newBottle['Domaine / Propriété']} 
                  onChange={(e) => handleFormChange('Domaine / Propriété', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Cuvée / Style</label>
                <input 
                  type="text" 
                  placeholder="Ex: Grand Cru Classé"
                  value={newBottle['Cuvée / Style']} 
                  onChange={(e) => handleFormChange('Cuvée / Style', e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ flex: '1 1 150px' }}>
                  <label>Région</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Bordeaux"
                    value={newBottle['Région']} 
                    onChange={(e) => handleFormChange('Région', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ flex: '1 1 150px' }}>
                  <label>Appellation / IGP</label>
                  <input 
                    type="text" 
                    placeholder="Ex: Margaux"
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
                    placeholder="Ex: Rouge, Blanc sec, etc."
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
