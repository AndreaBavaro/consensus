import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faReddit, faXTwitter } from '@fortawesome/free-brands-svg-icons';

export const RedditMark = ({ size = 16 }: { size?: number }) => <FontAwesomeIcon icon={faReddit} style={{ width: size, height: size, color: '#FF4500' }} />;
export const XMark = ({ size = 15 }: { size?: number }) => <FontAwesomeIcon icon={faXTwitter} style={{ width: size, height: size }} />;

/** The Consensus mark: three orange bars, same artwork as /favicon.svg. */
export const LogoMark = ({ size = 24, className }: { size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} viewBox="4 4 24 24" aria-hidden="true" focusable="false">
    <path fill="#FF6B35" d="M6 26h4V12H6v14zm8 0h4V6h-4v20zm8 0h4v-8h-4v8z" />
  </svg>
);
