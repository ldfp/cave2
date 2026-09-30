import { useState, useEffect, useMemo } from 'react'
import dbData from './db.json'
import './App.css'

function App() {
  const [bottles, setBottles] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  // Form State
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [selectedBottle, setSelectedBottle] = useState(null)
  const [newBottle, setNewBottle] = useState({
    'Domaine / Propriété': '',
    'Cuvée / Style': '',
    'Appellation / IGP': '',
    'Région': '',
    'Type de vin': '',
    'Millésime': new Date().getFullYear(),
    'Quantité': 1,
    image: ''
  })

  useEffect(() => {
    // Add unique IDs to the initial data for easier updates
    const initialData = (dbData.bottles || []).map((b, index) => ({
      ...b,
      id: `initial-${index}`
    }))
    setBottles(initialData)
  }, [])

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
      image: ''
    })
  }

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewBottle(prev => ({ ...prev, image: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleExistingImageUpload = (e, id) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setBottles(prevBottles => 
          prevBottles.map(bottle => bottle.id === id ? { ...bottle, image: reader.result } : bottle)
        );
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFormChange = (field, value) => {
    setNewBottle(prev => ({ ...prev, [field]: value }))
  }

  const handleUpdateQuantity = (id, delta) => {
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

  return (
    <div className="app-container">
      <header>
        <h1 className="gradient-text">Gestion de ma cave</h1>
        <button className="add-btn" onClick={() => setIsFormOpen(true)}>+ Ajouter une bouteille</button>
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
          <h2>Mon Inventaire</h2>
          
          <div className="filters-container">
            <input 
              type="text" 
              className="search-input" 
              placeholder="Rechercher un domaine, une cuvée, une appellation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            
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
              filteredBottles.map((bottle) => (
                <div key={bottle.id} className="bottle-item">
                  <div className="bottle-main-content">
                    {bottle.image ? (
                      <div className="bottle-image-container" onClick={() => setSelectedBottle(bottle)} style={{ cursor: 'pointer' }} title="Cliquez pour agrandir">
                        <img src={bottle.image} alt={bottle['Domaine / Propriété']} className="bottle-image" />
                      </div>
                    ) : (
                      <div className="bottle-image-placeholder">
                        <label htmlFor={`upload-${bottle.id}`} className="upload-label">
                          + Photo
                        </label>
                        <input 
                          id={`upload-${bottle.id}`}
                          type="file" 
                          accept="image/*" 
                          onChange={(e) => handleExistingImageUpload(e, bottle.id)}
                          style={{ display: 'none' }}
                        />
                      </div>
                    )}
                    <div className="bottle-info">
                      <span className="bottle-name">
                        {bottle['Domaine / Propriété']} 
                        {bottle['Cuvée / Style'] ? ` - ${bottle['Cuvée / Style']}` : ''}
                      </span>
                      <span className="bottle-type">
                        {bottle['Appellation / IGP']} • {bottle['Type de vin']}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                    <span className="bottle-year">{bottle['Millésime']}</span>
                    <div className="qty-controls">
                      <button 
                        className="qty-btn" 
                        onClick={() => handleUpdateQuantity(bottle.id, -1)}
                        disabled={bottle['Quantité'] <= 0}
                      >-</button>
                      <span className="qty-value">{bottle['Quantité']}</span>
                      <button 
                        className="qty-btn" 
                        onClick={() => handleUpdateQuantity(bottle.id, 1)}
                      >+</button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                Aucune bouteille ne correspond à vos critères de recherche.
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Modal d'ajout */}
      {isFormOpen && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <button className="close-btn" onClick={() => setIsFormOpen(false)}>&times;</button>
            <h2>Nouvelle Bouteille</h2>
            <form onSubmit={handleAddBottle}>
              <div className="form-group">
                <label>Photo de la bouteille</label>
                <input 
                  type="file" 
                  accept="image/*"
                  onChange={handleImageUpload}
                />
                {newBottle.image && (
                  <img src={newBottle.image} alt="Aperçu" style={{ height: '80px', marginTop: '10px', borderRadius: '8px', objectFit: 'cover' }} />
                )}
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
                    placeholder="Ex: Rouge"
                    value={newBottle['Type de vin']} 
                    onChange={(e) => handleFormChange('Type de vin', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ width: '100px' }}>
                  <label>Millésime</label>
                  <input 
                    type="text" 
                    value={newBottle['Millésime']} 
                    onChange={(e) => handleFormChange('Millésime', e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ width: '80px' }}>
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
      {/* Modal Image Agrandie */}
      {selectedBottle && (
        <div className="modal-overlay" onClick={() => setSelectedBottle(null)}>
          <div className="modal-content glass-panel" style={{ maxWidth: '500px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedBottle(null)}>&times;</button>
            <h2>Photo : {selectedBottle['Domaine / Propriété']}</h2>
            <div style={{ margin: '20px 0' }}>
              <img 
                src={selectedBottle.image} 
                alt={selectedBottle['Domaine / Propriété']} 
                style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: '8px', objectFit: 'contain' }} 
              />
            </div>
            <div>
              <label htmlFor="replace-photo-modal" className="add-btn" style={{ cursor: 'pointer', display: 'inline-block' }}>
                Remplacer la photo
              </label>
              <input 
                id="replace-photo-modal"
                type="file" 
                accept="image/*" 
                style={{ display: 'none' }}
                onChange={(e) => {
                  handleExistingImageUpload(e, selectedBottle.id);
                  const file = e.target.files[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setSelectedBottle(prev => ({ ...prev, image: reader.result }));
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default App
