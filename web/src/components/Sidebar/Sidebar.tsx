import React, { useState, useEffect } from 'react';
import NewChatButton from '../NewChatButton/NewChatButton';
import ChatHistory from '../ChatHistory/ChatHistory';
import styles from './Sidebar.module.css';

const themes = [
  { id: '', label: 'Light', icon: '☀️' },
  { id: 'sunset', label: 'Sunset', icon: '🌅' },
  { id: 'night', label: 'Night', icon: '🌙' },
  { id: 'shadow', label: 'Shadow', icon: '◐' }
];

const Sidebar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [currentTheme, setCurrentTheme] = useState(() => {
    const savedTheme = localStorage.getItem('userTheme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
    return savedTheme || document.documentElement.getAttribute('data-theme') || '';
  });
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setIsOpen(false);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const setTheme = (themeId) => {
    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem('userTheme', themeId);
    setCurrentTheme(themeId);
    setIsThemeMenuOpen(false);
  };

  const currentThemeData = themes.find(t => t.id === currentTheme) || themes[0];

  return (
    <div className={`${styles.sidebar} ${isMobile ? styles.mobile : ''} ${isMobile && isOpen ? styles.open : ''}`}>
      {isMobile && (
        <div className={styles.sidebarHeader}>
          <button 
            className={styles.toggleButton}
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle Sidebar"
          >
            {isOpen ? '‹' : '›'}
          </button>
        </div>
      )}
      <div className={styles.sidebarContent}>
        <ChatHistory />
      </div>
      <div className={styles.themeContainer}>
        <button 
          className={styles.themeToggle}
          onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
          aria-label="Open theme menu"
          title="Change theme"
        >
          <span className={styles.currentTheme}>
            <span className={styles.themeIcon}>{currentThemeData.icon}</span>
            <span className={styles.themeLabel}>{currentThemeData.label}</span>
          </span>
        </button>
        {isThemeMenuOpen && (
          <div className={styles.themeMenu}>
            {themes.map(theme => (
              <button
                key={theme.id}
                className={`${styles.themeOption} ${currentTheme === theme.id ? styles.active : ''}`}
                onClick={() => setTheme(theme.id)}
                aria-label={`Switch to ${theme.label} theme`}
              >
                <span className={styles.themeIcon}>{theme.icon}</span>
                <span className={styles.themeLabel}>{theme.label}</span>
                {currentTheme === theme.id && (
                  <span className={styles.activeIndicator}>✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
