/**
 * DeleteAccountSection G GDPR Article 17 self-service data deletion.
 * Shows in Settings page. Requires confirmation before proceeding.
 */
import React, { useState } from 'react';
import apiClient from '../../lib/apiClient';

const DeleteAccountSection = ({ onDeleted }) => {
  const [step, setStep] = useState('idle');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    if (confirmText !== 'DELETE') return;
    setLoading(true);
    setError(null);
    try {
      await apiClient.post('/api/compliance/delete-my-data');
      setStep('done');
      // Clear local auth state after a short delay
      setTimeout(() => {
        localStorage.removeItem('raw-surf-user');
        localStorage.removeItem('raw-surf-token');
        window.location.href = '/auth';
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') {
    return (
      <div style={{
        padding: 24,
        textAlign: 'center',
        background: 'rgba(239,68,68,0.05)',
        borderRadius: 12,
        border: '1px solid rgba(239,68,68,0.15)'
      }}>
 <div style={{ fontSize: 40, marginBottom: 12 }}>G</div>
        <p style={{ color: '#f1f5f9', fontWeight: 600, margin: 0 }}>
          Account data deleted
        </p>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 0' }}>
          Redirecting to login...
        </p>
      </div>
    );
  }

  return (
    <div style={{
      padding: 16,
      background: 'rgba(239,68,68,0.03)',
      borderRadius: 12,
      border: '1px solid rgba(239,68,68,0.1)'
    }}>
      <h4 style={{
        margin: '0 0 8px',
        fontSize: 15,
        fontWeight: 600,
        color: '#ef4444'
      }}>
        Delete My Account
      </h4>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
        Permanently delete your account and all associated data. This action cannot be undone. 
        Financial records are retained for legal compliance.
      </p>

      {step === 'idle' && (
        <button
          onClick={() => setStep('confirm')}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            color: '#ef4444',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600
          }}
        >
          Request Data Deletion
        </button>
      )}

      {step === 'confirm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            padding: 12,
            background: 'rgba(239,68,68,0.08)',
            borderRadius: 8,
            fontSize: 12,
            color: '#fca5a5',
            lineHeight: 1.5
          }}>
 Gn+ This will permanently delete your posts, comments, follows, check-ins, and reviews.
            Your profile will be anonymized. Type <strong>DELETE</strong> to confirm.
          </div>
          <input aria-label="Text input"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='Type "DELETE" to confirm'
            style={{
              padding: '10px 12px',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 8,
              color: '#f1f5f9',
              fontSize: 14,
              outline: 'none'
            }}
          />
          {error && (
            <p style={{ margin: 0, color: '#ef4444', fontSize: 12 }}>{error}</p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setStep('idle'); setConfirmText(''); setError(null); }}
              style={{
                flex: 1,
                padding: '10px 0',
                background: 'rgba(255,255,255,0.05)',
                color: '#94a3b8',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={confirmText !== 'DELETE' || loading}
              style={{
                flex: 1,
                padding: '10px 0',
                background: confirmText === 'DELETE'
                  ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                  : 'rgba(239,68,68,0.1)',
                color: confirmText === 'DELETE' ? '#fff' : '#94a3b8',
                border: 'none',
                borderRadius: 8,
                cursor: confirmText === 'DELETE' ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 600,
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? 'Deleting...' : 'Delete Forever'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeleteAccountSection;
