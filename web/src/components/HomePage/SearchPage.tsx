import React, { useEffect, useRef, useState } from 'react';
import styles from './SearchPage.module.css';
import SearchResult from './SearchResult/SearchResult';
import Sidebar from '../Sidebar/Sidebar'; 
import SearchBar from './SearchBar/SearchBar';
import { useSession } from '../../context/SessionContext';
import { history } from '../../services/history';
import { useNavigate, useSearchParams } from 'react-router-dom';

const SearchPage = () => {
  const [themeData, setThemeData] = useState([]);
  const [comments, setComments] = useState([]);
  const { currentQuery, messages, fromDate, toDate, dateFilter, setSessionId, setMessagesArray, setCurrentQuery } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    if (currentQuery || messages.length) return;
    // A refresh or shared link: reopen the saved chat from this browser's history if it exists.
    const saved = history.get(params.get('session') ?? '');
    if (!saved) {
      navigate('/');
      return;
    }
    setSessionId(saved.id);
    setMessagesArray([...saved.messages].reverse());
    setCurrentQuery('');
  }, [currentQuery, messages, navigate, params]);


  return (
    <div className={styles.pageWrapper}>
      <Sidebar />
      <div className={styles.container}>
        <div className={styles.searchBarContainer}>
          <SearchBar 
            isHomePage={false}
          />
        </div>
        <div className={styles.searchResults}>
          {messages.map((message, index) => (
            <SearchResult
              key={`${message.query}-${index}`}
              liveQuery={message.messageData == null ? currentQuery : null}
              query={message.query}
              messageData={message.messageData}
              isHistorical={message.messageData !== null && message.query != currentQuery}
              onThemeDataUpdate={setThemeData}
              onCommentsUpdate={setComments}
              dateFilter={message.messageData == null ? dateFilter : message.dateFilter}
              fromDate={message.messageData == null ? fromDate : message.fromDate}
              toDate={message.messageData == null ? toDate : message.toDate}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default SearchPage;
