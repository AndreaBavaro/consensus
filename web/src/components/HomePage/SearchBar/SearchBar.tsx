import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useSession } from '../../../context/SessionContext';
import styles from './SearchBar.module.css';

import React, { useState, useRef } from 'react';

import { faChevronDown, faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';

const timeFilters = [
  { id: 'all', label: 'Most recent' },
  { id: '24h', label: 'Past 24h' },
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
  { id: 'year', label: 'Past year' },
  { id: 'custom', label: 'Custom' },
];

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MIN_YEAR = 2009;
const MAX_YEAR = new Date().getFullYear();

const SearchBar = ({ isHomePage }: { isHomePage: boolean }) => {
  const navigate = useNavigate();
  const { 
    setCurrentQueryWithDates, 
    addMessage, 
    fromDate, 
    toDate, 
    dateFilter, 
    setFromDate, 
    setToDate, 
    setDateFilter 
  } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState(
    timeFilters.find(f => f.id === dateFilter) || timeFilters[0]
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showCustomView, setShowCustomView] = useState(dateFilter === 'custom');
  const [fromYear, setFromYear] = useState(fromDate ? fromDate.getFullYear() : MAX_YEAR);
  const [fromMonth, setFromMonth] = useState(fromDate ? fromDate.getMonth() : new Date().getMonth());
  const [toYear, setToYear] = useState(toDate ? toDate.getFullYear() : MAX_YEAR);
  const [toMonth, setToMonth] = useState(toDate ? toDate.getMonth() : new Date().getMonth());
  const dropdownRef = useRef(null);

  const handleWindowClick = (e) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
      setIsDropdownOpen(false);
      setShowCustomView(false);
    }
  };

  const toggleDropdown = (e) => {
    e.stopPropagation();
    if (!isDropdownOpen) {
      window.addEventListener('click', handleWindowClick);
    } else {
      window.removeEventListener('click', handleWindowClick);
    }
    setIsDropdownOpen(!isDropdownOpen);
  };

  const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getFilterDisplay = () => {
    if (window.innerWidth <= 768) {
      return selectedFilter.label;  // Always show filter label on mobile
    }
    if (fromDate || toDate) {
      return `${formatDate(fromDate)} - ${formatDate(toDate)}`;
    }
    return selectedFilter.label;
  };

  const handleSearch = async () => {
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      
      try {
        // Update current query with dates (triggers streaming)
        setCurrentQueryWithDates(trimmedQuery, fromDate, toDate, dateFilter);
        addMessage(trimmedQuery, fromDate, toDate, dateFilter);
        if (isHomePage) {
          navigate('/search');
        }
        // Scroll to top when new search is initiated
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) {
        console.error('Error searching:', error);
      }
    }
  };

  const handleFilterSelect = (filter) => {
    setSelectedFilter(filter);
    setDateFilter(filter.id);
    
    if (filter.id === 'custom') {
      setShowCustomView(true);
      const now = new Date();
      
      // Set toDate to current month if it's not already set
      if (!toDate) {
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        setToDate(lastDayOfMonth);
        setToYear(now.getFullYear());
        setToMonth(now.getMonth());
      }
      
      // Set fromDate to 1 year before toDate if it's not already set
      if (!fromDate) {
        const oneYearBefore = new Date(toDate || now);
        oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
        const firstDayOfMonth = new Date(oneYearBefore.getFullYear(), oneYearBefore.getMonth(), 1);
        setFromDate(firstDayOfMonth);
        setFromYear(firstDayOfMonth.getFullYear());
        setFromMonth(firstDayOfMonth.getMonth());
      }
    } else {
      setShowCustomView(false);
      let newFromDate = null;
      let newToDate = null;
      
      const now = new Date();
      
      switch (filter.id) {
        case '24h':
          newFromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          newToDate = now;
          break;
        case 'week':
          newFromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          newToDate = now;
          break;
        case 'month':
          newFromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          newToDate = now;
          break;
        case 'year':
          newFromDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          newToDate = now;
          break;
        default:
          newFromDate = null;
          newToDate = null;
      }
      
      setFromDate(newFromDate);
      setToDate(newToDate);
      setIsDropdownOpen(false);
    }
  };

  const handleBackClick = () => {
    setShowCustomView(false);
    setDateFilter('custom');
  };

  const handleYearChange = (isFrom, increment) => {
    if (isFrom) {
      const newYear = fromYear + increment;
      if (newYear >= MIN_YEAR && newYear <= MAX_YEAR) {
        setFromYear(newYear);
        setFromDate(new Date(newYear, fromMonth, 1));
        if (toYear < newYear) {
          setToYear(newYear);
          setToDate(new Date(newYear, toMonth, 1));
        }
      }
    } else {
      const newYear = toYear + increment;
      if (newYear >= MIN_YEAR && newYear <= MAX_YEAR && newYear >= fromYear) {
        setToYear(newYear);
        setToDate(new Date(newYear, toMonth + 1, 0)); // Last day of the month
      }
    }
    setDateFilter('custom');
  };

  const handleMonthChange = (isFrom, increment) => {
    if (isFrom) {
      let newMonth = fromMonth + increment;
      let newYear = fromYear;

      if (newMonth > 11) {
        newMonth = 0;
        newYear++;
      } else if (newMonth < 0) {
        newMonth = 11;
        newYear--;
      }

      if (newYear >= MIN_YEAR && newYear <= MAX_YEAR) {
        setFromMonth(newMonth);
        setFromYear(newYear);
        setFromDate(new Date(newYear, newMonth, 1));
        
        // Adjust to date if it's before from date
        const newFromDate = new Date(newYear, newMonth, 1);
        const currentToDate = new Date(toYear, toMonth + 1, 0);
        if (currentToDate < newFromDate) {
          setToYear(newYear);
          setToMonth(newMonth);
          setToDate(new Date(newYear, newMonth + 1, 0));
        }
      }
    } else {
      let newMonth = toMonth + increment;
      let newYear = toYear;

      if (newMonth > 11) {
        newMonth = 0;
        newYear++;
      } else if (newMonth < 0) {
        newMonth = 11;
        newYear--;
      }

      if (newYear >= MIN_YEAR && newYear <= MAX_YEAR && 
          (newYear > fromYear || (newYear === fromYear && newMonth >= fromMonth))) {
        setToMonth(newMonth);
        setToYear(newYear);
        setToDate(new Date(newYear, newMonth + 1, 0)); // Last day of the month
      }
    }
    setDateFilter('custom');
  };

  const closeDropdown = () => {
    setIsDropdownOpen(false);
    setShowCustomView(false);
  };

  return (
    <div className={`${styles.container} ${isHomePage ? styles.homePageContainer : ''}`}>
      <div className={styles.searchWrapper}>
        <div className={styles.filterWrapper}>
          <button
            className={`${styles.timeFilterButton} ${(fromDate || toDate) ? styles.dateSelected : ''}`}
            onClick={toggleDropdown}
          >
            {getFilterDisplay()}
            <FontAwesomeIcon icon={faChevronDown} className={styles.timeFilterIcon} />
          </button>
          {isDropdownOpen && (
            <div ref={dropdownRef} onClick={e => e.stopPropagation()}>
              {!showCustomView ? (
                <div className={styles.dropdownMenu}>
                  {timeFilters.map((filter) => (
                    <button
                      key={filter.id}
                      className={`${styles.dropdownItem} ${selectedFilter.id === filter.id ? styles.selected : ''}`}
                      onClick={() => handleFilterSelect(filter)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.customDateView}>
                  <div className={styles.dateSelector}>
                    <div className={styles.headerRow}>
                      <span className={styles.dateLabel}>From</span>
                      <button className={styles.backButton} onClick={handleBackClick}>
                        <FontAwesomeIcon icon={faChevronLeft} className={styles.backIcon} />
                        <span>Back</span>
                      </button>
                    </div>
                    <div className={styles.fromDate}>
                      <div className={styles.dateControls}>
                        <div className={styles.yearSelector}>
                          <FontAwesomeIcon 
                            icon={faChevronLeft} 
                            className={styles.chevron}
                            onClick={() => handleYearChange(true, -1)} 
                          />
                          <span>{fromYear}</span>
                          <FontAwesomeIcon 
                            icon={faChevronRight} 
                            className={styles.chevron}
                            onClick={() => handleYearChange(true, 1)} 
                          />
                        </div>
                        <div className={styles.monthSelector}>
                          <FontAwesomeIcon 
                            icon={faChevronLeft} 
                            className={styles.chevron}
                            onClick={() => handleMonthChange(true, -1)} 
                          />
                          <span>{months[fromMonth]}</span>
                          <FontAwesomeIcon 
                            icon={faChevronRight} 
                            className={styles.chevron}
                            onClick={() => handleMonthChange(true, 1)} 
                          />
                        </div>
                      </div>
                    </div>
                    <div className={styles.toDate}>
                      <span className={styles.dateLabel}>To</span>
                      <div className={styles.dateControls}>
                        <div className={styles.yearSelector}>
                          <FontAwesomeIcon 
                            icon={faChevronLeft} 
                            className={styles.chevron}
                            onClick={() => handleYearChange(false, -1)} 
                          />
                          <span>{toYear}</span>
                          <FontAwesomeIcon 
                            icon={faChevronRight} 
                            className={styles.chevron}
                            onClick={() => handleYearChange(false, 1)} 
                          />
                        </div>
                        <div className={styles.monthSelector}>
                          <FontAwesomeIcon 
                            icon={faChevronLeft} 
                            className={styles.chevron}
                            onClick={() => handleMonthChange(false, -1)} 
                          />
                          <span>{months[toMonth]}</span>
                          <FontAwesomeIcon 
                            icon={faChevronRight} 
                            className={styles.chevron}
                            onClick={() => handleMonthChange(false, 1)} 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Find human opinions on..."
          className={styles.searchInput}
        />
        <button 
          className={styles.searchButton}
          onClick={handleSearch}
          aria-label="Search"
        >
          <svg
            className={styles.searchIcon}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default SearchBar;
