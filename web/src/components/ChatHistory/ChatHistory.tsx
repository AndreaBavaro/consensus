import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { history } from '../../services/history';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChartBar } from '@fortawesome/free-solid-svg-icons';
import NewChatButton from '../NewChatButton/NewChatButton';
import SessionOptionsMenu from './SessionOptionsMenu';
import styles from './ChatHistory.module.css';
import { useSession } from '../../context/SessionContext';

const ChatHistory = () => {
  const [hoveredSessionId, setHoveredSessionId] = useState(null);
  const navigate = useNavigate();
  const { sessionList, deleteSession, setSessionId, setMessagesArray, setCurrentQuery, sessionId } = useSession();

  const handleSessionClick = (session) => {
    const saved = history.get(session.id);
    if (!saved) return;
    setSessionId(saved.id);
    setMessagesArray([...saved.messages].reverse());
    setCurrentQuery('');
    navigate(`/search?session=${saved.id}`);
  };

  const handleDeleteSession = (id) => {
    deleteSession(id);
    if (id === sessionId) {
      setSessionId(null);
      setMessagesArray([]);
      setCurrentQuery(null);
      navigate('/');
    }
  };

  return (
    <div className={styles.chatHistory}>
      <div 
        className={styles.titleContainer}
        onClick={() => {
          setSessionId(null);
          setMessagesArray([]);
          setCurrentQuery(null);
          navigate('/');
        }}
        style={{ cursor: 'pointer' }}
      >
        <FontAwesomeIcon icon={faChartBar} className={styles.logoIcon} />
        <h2 className={styles.title}>Consensus</h2>

      </div>
      <NewChatButton />
      <div className={styles.sessionList}>
        {sessionList.length === 0 && <p className={styles.empty}>Your searches show up here. They stay in this browser only.</p>}
        {sessionList.map((session) => (
          <div 
            key={session.id} 
            className={`${styles.sessionItem} ${session.id === sessionId ? styles.active : ''}`}
            onClick={() => handleSessionClick(session)}
            onMouseEnter={() => setHoveredSessionId(session.id)}
            onMouseLeave={() => setHoveredSessionId(null)}
          >
            <span className={styles.sessionTitle}>
              {session.title}
            </span>
            <SessionOptionsMenu 
              onDelete={() => handleDeleteSession(session.id)}
              visible={hoveredSessionId === session.id}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ChatHistory;
