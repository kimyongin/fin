import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchActiveViewerAccess,
  fetchFriends,
  fetchPortfolioViewers,
  fetchViewerProfile,
} from '../portfolio/data'
import { createFriendDraft, createViewerProfileDraft, isViewerSchemaMissingError } from '../../lib/viewerAccess'

export function useSharingProfile({ activeTab, isAnonymousSession, onFriendAdded, onFriendRemoved, sessionUserId, supabase }) {
  const [viewerProfileSchemaReady, setViewerProfileSchemaReady] = useState(true)
  const [viewerProfileSaving, setViewerProfileSaving] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [viewerProfileLoaded, setViewerProfileLoaded] = useState(false)
  const [viewerProfileError, setViewerProfileError] = useState('')
  const [viewerProfileErrorTarget, setViewerProfileErrorTarget] = useState('sharing')
  const [viewerProfileMessage, setViewerProfileMessage] = useState('')
  const [viewerProfile, setViewerProfile] = useState(() => createViewerProfileDraft())
  const [viewerProfileDraft, setViewerProfileDraft] = useState(() => createViewerProfileDraft())
  const [friends, setFriends] = useState([])
  const [portfolioViewers, setPortfolioViewers] = useState([])
  const [portfolioViewersNextOffset, setPortfolioViewersNextOffset] = useState(null)
  const [portfolioViewersError, setPortfolioViewersError] = useState('')
  const [portfolioViewersLoading, setPortfolioViewersLoading] = useState(false)
  const [friendDraft, setFriendDraft] = useState(() => createFriendDraft())
  const [friendError, setFriendError] = useState('')
  const [friendSaving, setFriendSaving] = useState(false)
  const avatarWriteRef = useRef(false)
  const currentUserRef = useRef(sessionUserId)
  const previousUserRef = useRef(sessionUserId)
  currentUserRef.current = sessionUserId

  useEffect(() => {
    const previousUserId = previousUserRef.current
    previousUserRef.current = sessionUserId
    if (sessionUserId && (!previousUserId || previousUserId === sessionUserId)) return
    setFriends([])
    setPortfolioViewers([])
    setPortfolioViewersNextOffset(null)
    setPortfolioViewersError('')
    setPortfolioViewersLoading(false)
    setFriendDraft(createFriendDraft())
    setFriendError('')
    setFriendSaving(false)
    setAvatarError('')
    setAvatarSaving(false)
    setViewerProfile(createViewerProfileDraft())
    setViewerProfileDraft(createViewerProfileDraft())
    setViewerProfileLoaded(false)
  }, [sessionUserId])

  const loadPortfolioViewers = useCallback(async (offset = 0) => {
    const requestedBy = currentUserRef.current
    setPortfolioViewersLoading(true)
    setPortfolioViewersError('')
    try {
      const page = await fetchPortfolioViewers(supabase, offset)
      if (currentUserRef.current !== requestedBy) return
      setPortfolioViewers((current) => offset === 0 ? page.items : [...current, ...page.items])
      setPortfolioViewersNextOffset(page.nextOffset)
    } catch (error) {
      if (currentUserRef.current !== requestedBy) return
      setPortfolioViewersError(error.message ?? '공유받는 친구를 불러오지 못했습니다.')
    } finally {
      if (currentUserRef.current === requestedBy) setPortfolioViewersLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    if (activeTab === 'settings' && sessionUserId && !isAnonymousSession) loadPortfolioViewers()
  }, [activeTab, isAnonymousSession, loadPortfolioViewers, sessionUserId])

  const loadFriends = useCallback(async () => {
    const requestedBy = currentUserRef.current
    try {
      const nextFriends = await fetchFriends(supabase)
      if (currentUserRef.current !== requestedBy) return []
      setFriends(nextFriends)
      return nextFriends
    } catch (error) {
      if (currentUserRef.current !== requestedBy) return []
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setFriends([])
        return []
      }
      throw error
    }
  }, [supabase])

  const loadActiveViewerAccess = useCallback(async () => {
    const requestedBy = currentUserRef.current
    try {
      const access = await fetchActiveViewerAccess(supabase)
      return currentUserRef.current === requestedBy ? access : null
    } catch (error) {
      if (currentUserRef.current !== requestedBy) return null
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        return null
      }
      throw error
    }
  }, [supabase])

  const loadViewerProfile = useCallback(async (preserveDraft = false) => {
    const requestedBy = currentUserRef.current
    setViewerProfileError('')
    setViewerProfileMessage('')
    setViewerProfileLoaded(false)
    try {
      const nextProfile = createViewerProfileDraft(await fetchViewerProfile(supabase))
      if (currentUserRef.current !== requestedBy) return
      setViewerProfileSchemaReady(true)
      setViewerProfile(nextProfile)
      setViewerProfileDraft((current) => preserveDraft
        ? { ...current, avatar_key: nextProfile.avatar_key, viewer_password_updated_at: nextProfile.viewer_password_updated_at }
        : nextProfile)
      setViewerProfileLoaded(true)
    } catch (error) {
      if (currentUserRef.current !== requestedBy) return
      if (isViewerSchemaMissingError(error)) {
        setViewerProfileSchemaReady(false)
        setViewerProfile(createViewerProfileDraft())
        setViewerProfileDraft(createViewerProfileDraft())
        return
      }
      setViewerProfileErrorTarget('sharing')
      setViewerProfileError(error.message ?? '공유 설정을 불러오지 못했습니다.')
      throw error
    }
  }, [supabase])

  const handleAvatarSelect = useCallback(async (avatarKey) => {
    if (avatarWriteRef.current || !viewerProfileLoaded || !viewerProfileSchemaReady || avatarKey === viewerProfile.avatar_key) return
    avatarWriteRef.current = true
    const requestedBy = currentUserRef.current
    const previousAvatarKey = viewerProfile.avatar_key
    setAvatarSaving(true)
    setAvatarError('')
    setViewerProfile((current) => ({ ...current, avatar_key: avatarKey }))
    setViewerProfileDraft((current) => ({ ...current, avatar_key: avatarKey }))
    try {
      const { data, error } = await supabase.rpc('app_set_profile_avatar', { input_avatar_key: avatarKey })
      if (currentUserRef.current !== requestedBy) return
      if (error) throw error
      setViewerProfile((current) => ({ ...current, avatar_key: data }))
      setViewerProfileDraft((current) => ({ ...current, avatar_key: data }))
    } catch (error) {
      if (currentUserRef.current !== requestedBy) return
      setViewerProfile((current) => ({ ...current, avatar_key: previousAvatarKey }))
      setViewerProfileDraft((current) => ({ ...current, avatar_key: previousAvatarKey }))
      setAvatarError(error.message ?? '아이콘을 저장하지 못했습니다.')
    } finally {
      avatarWriteRef.current = false
      if (currentUserRef.current === requestedBy) setAvatarSaving(false)
    }
  }, [supabase, viewerProfile.avatar_key, viewerProfileLoaded, viewerProfileSchemaReady])

  const handleAddFriend = useCallback(async () => {
    const requestedBy = currentUserRef.current
    setFriendSaving(true)
    setFriendError('')
    try {
      const { data, error } = await supabase.rpc('add_friend', {
        input_public_name: friendDraft.public_name.trim(),
        input_viewer_password: friendDraft.viewer_password,
      })
      if (currentUserRef.current !== requestedBy) return
      if (error) throw error
      const friend = Array.isArray(data) ? data[0] : data
      const nextFriends = await loadFriends()
      if (currentUserRef.current !== requestedBy) return
      setFriendDraft(createFriendDraft())
      if (friend?.owner_user_id && nextFriends.some((item) => item.owner_user_id === friend.owner_user_id)) {
        await onFriendAdded(friend)
      }
    } catch (error) {
      if (currentUserRef.current !== requestedBy) return
      setFriendError(error.message ?? '친구를 추가하지 못했습니다.')
    } finally {
      if (currentUserRef.current === requestedBy) setFriendSaving(false)
    }
  }, [friendDraft, loadFriends, onFriendAdded, supabase])

  const handleRemoveFriend = useCallback(async (ownerUserId) => {
    const requestedBy = currentUserRef.current
    setFriendSaving(true)
    setFriendError('')
    try {
      const { error } = await supabase.rpc('remove_friend', { input_owner_user_id: ownerUserId })
      if (currentUserRef.current !== requestedBy) return
      if (error) throw error
      await loadFriends()
      if (currentUserRef.current !== requestedBy) return
      await onFriendRemoved(ownerUserId)
    } catch (error) {
      if (currentUserRef.current !== requestedBy) return
      setFriendError(error.message ?? '친구를 해제하지 못했습니다.')
    } finally {
      if (currentUserRef.current === requestedBy) setFriendSaving(false)
    }
  }, [loadFriends, onFriendRemoved, supabase])

  function changeFriendDraft(field, value) {
    setFriendError('')
    setFriendDraft((current) => ({ ...current, [field]: value }))
  }

  function changeViewerProfileDraft(field, value) {
    setViewerProfileError('')
    setViewerProfileMessage('')
    setViewerProfileDraft((current) => ({ ...current, [field]: value }))
  }

  return {
    avatarError, avatarSaving, changeFriendDraft, changeViewerProfileDraft, friendDraft, friendError,
    friendSaving, friends, handleAddFriend, handleAvatarSelect, handleRemoveFriend,
    loadActiveViewerAccess, loadFriends, loadPortfolioViewers, loadViewerProfile,
    portfolioViewers, portfolioViewersError, portfolioViewersLoading, portfolioViewersNextOffset,
    setViewerProfile, setViewerProfileDraft, setViewerProfileError, setViewerProfileErrorTarget,
    setViewerProfileLoaded, setViewerProfileMessage, setViewerProfileSaving, setViewerProfileSchemaReady,
    viewerProfile, viewerProfileDraft, viewerProfileError, viewerProfileErrorTarget,
    viewerProfileLoaded, viewerProfileMessage, viewerProfileSaving, viewerProfileSchemaReady,
  }
}
