import { FC, ReactNode } from 'react';

// Reusable nested drawer used to split the large settings surface into smaller sections.
export const SettingsSectionDrawer: FC<{
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}> = ({ title, isOpen, onToggle, children }) => {
  return (
    <div className="inline-drawer ztracker-settings-section">
      <div
        className="inline-drawer-toggle inline-drawer-header"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
      >
        <b>{title}</b>
        <div className={`inline-drawer-icon fa-solid fa-circle-chevron-down ${isOpen ? 'down' : ''}`}></div>
      </div>
      <div className="inline-drawer-content" style={{ display: isOpen ? 'block' : 'none' }}>
        <div className="ztracker-section-content">{children}</div>
      </div>
    </div>
  );
};