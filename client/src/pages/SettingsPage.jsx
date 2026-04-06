import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import api from '../lib/api'
import toast from 'react-hot-toast'

function CalendarSection() {
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleGetLink() {
    setLoading(true)
    try {
      const { data } = await api.get('/calendar/token')
      setToken(data.token)
    } catch {
      toast.error('Failed to generate calendar link')
    } finally {
      setLoading(false)
    }
  }

  const feedUrl = token ? `${window.location.origin}/api/calendar/feed?token=${token}` : null
  const webcalUrl = feedUrl?.replace(/^https?:/, 'webcal:')

  return (
    <div className="card p-6 mt-4">
      <h2 className="font-semibold text-gray-900 mb-1">Apple Calendar</h2>
      <p className="text-sm text-gray-500 mb-4">
        Subscribe to a live feed of your tasks with due dates. Syncs automatically — no setup needed beyond the first subscribe.
      </p>
      {!token ? (
        <button className="btn-secondary" onClick={handleGetLink} disabled={loading}>
          {loading ? 'Generating…' : 'Get calendar link'}
        </button>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              readOnly
              className="input text-xs font-mono"
              value={feedUrl}
              onFocus={e => e.target.select()}
            />
            <button
              className="btn-secondary flex-shrink-0"
              onClick={() => { navigator.clipboard.writeText(feedUrl); toast.success('Copied!') }}
            >
              Copy
            </button>
          </div>
          <a href={webcalUrl} className="btn-primary inline-flex">
            Subscribe in Apple Calendar
          </a>
          <p className="text-xs text-gray-400">
            Works with any app that supports ICS subscriptions (Apple Calendar, Google Calendar, Outlook). Apple Calendar refreshes roughly every hour.
          </p>
        </div>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const { user, updateUser } = useAuth()

  const [profileForm, setProfileForm] = useState({ name: user?.name || '', email: user?.email || '' })
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  async function handleProfileSave(e) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const { data } = await api.put('/users/me', profileForm)
      updateUser(data)
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handlePasswordSave(e) {
    e.preventDefault()
    if (passwordForm.newPassword !== passwordForm.confirm) {
      toast.error('New passwords do not match')
      return
    }
    if (passwordForm.newPassword.length < 8) {
      toast.error('New password must be at least 8 characters')
      return
    }
    setSavingPassword(true)
    try {
      await api.put('/auth/update-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })
      toast.success('Password updated')
      setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update password')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Settings</h1>

      {/* Profile */}
      <div className="card p-6 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">Profile</h2>
        <form onSubmit={handleProfileSave} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              className="input"
              value={profileForm.name}
              onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={profileForm.email}
              onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={savingProfile}>
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </div>

      {/* Change password */}
      <div className="card p-6 mb-4">
        <h2 className="font-semibold text-gray-900 mb-4">Change password</h2>
        <form onSubmit={handlePasswordSave} className="space-y-4">
          <div>
            <label className="label">Current password</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={passwordForm.currentPassword}
              onChange={e => setPasswordForm(f => ({ ...f, currentPassword: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">New password</label>
            <input
              type="password"
              className="input"
              placeholder="Min. 8 characters"
              value={passwordForm.newPassword}
              onChange={e => setPasswordForm(f => ({ ...f, newPassword: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={passwordForm.confirm}
              onChange={e => setPasswordForm(f => ({ ...f, confirm: e.target.value }))}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={savingPassword}>
            {savingPassword ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>

      <CalendarSection />
    </div>
  )
}
