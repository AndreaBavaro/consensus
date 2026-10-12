import React, { useState, useRef } from 'react';
import styles from './SessionOptionsMenu.module.css';

const SessionOptionsMenu = ({ onDelete, visible }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  return (
    <div style={{ 
      position: 'relative', 
      marginLeft: '8px',
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.2s ease'
    }} 
    ref={menuRef}
    onMouseEnter={() => setIsOpen(true)}
    onMouseLeave={() => setIsOpen(false)}
    >
      <button 
        style={{
          background: 'none',
          border: 'none',
          padding: '4px 8px',
          cursor: 'pointer',
          color: 'var(--color-text)',
          fontSize: '20px',
          lineHeight: 1,
          transition: 'color 0.2s ease'
        }}
      >
        ⋮
      </button>
      {isOpen && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: '100%',
          background: 'var(--color-background)',
          borderRadius: '8px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
          zIndex: 1000,
          minWidth: '120px',
          padding: '4px 0'
        }}>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
              setIsOpen(false);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 16px',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text)',
              fontSize: '14px',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => (e.currentTarget.style.color = 'var(--color-primary)')}
            onMouseOut={(e) => (e.currentTarget.style.color = 'var(--color-text)')}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export default SessionOptionsMenu;
