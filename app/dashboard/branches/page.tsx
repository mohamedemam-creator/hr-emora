'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  CircleOff,
  Crosshair,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  Link2,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Region = {
  id: string
  name: string
  code: string
  is_active: boolean
  manager_employee_id: string | null
  manager_name: string | null
}

type Manager = {
  id: string
  employee_code: string
  full_name: string
  job_title_name: string | null
  is_assigned: boolean
}

type Branch = {
  id: string
  region_id: string | null
  region_name: string | null
  region_code: string | null
  name: string
  code: string
  address: string | null
  latitude: number | null
  longitude: number | null
  attendance_radius_m: number
  minimum_gps_accuracy_m: number
  is_active: boolean
  employee_count: number
  created_at: string
  updated_at: string
}

type Coordinates = {
  latitude: number
  longitude: number
  accuracy: number
  source: 'gps' | 'map' | 'search' | 'saved' | 'google'
}

type BranchForm = {
  id: string | null
  regionId: string | null
  regionName: string
  regionCode: string
  managerId: string
  branchName: string
  branchCode: string
  address: string
  radius: number
  accuracyLimit: number
  isActive: boolean
}

type LeafletMap = {
  setView: (center: [number, number], zoom: number) => void
  on: (event: string, handler: (event: { latlng: { lat: number; lng: number } }) => void) => void
  remove: () => void
  invalidateSize: () => void
}

type LeafletMarker = {
  setLatLng: (center: [number, number]) => LeafletMarker
  addTo: (map: LeafletMap) => LeafletMarker
  on: (event: string, handler: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void) => void
}

type LeafletCircle = {
  setLatLng: (center: [number, number]) => LeafletCircle
  setRadius: (radius: number) => LeafletCircle
  addTo: (map: LeafletMap) => LeafletCircle
}

declare global {
  interface Window {
    L?: {
      map: (element: HTMLElement, options?: Record<string, unknown>) => LeafletMap
      tileLayer: (url: string, options: Record<string, unknown>) => { addTo: (map: LeafletMap) => void }
      marker: (center: [number, number], options?: Record<string, unknown>) => LeafletMarker
      circle: (center: [number, number], options?: Record<string, unknown>) => LeafletCircle
    }
  }
}

const DEFAULT_CENTER: [number, number] = [30.04442, 31.235712]

const emptyForm: BranchForm = {
  id: null,
  regionId: null,
  regionName: '',
  regionCode: '',
  managerId: '',
  branchName: '',
  branchCode: '',
  address: '',
  radius: 150,
  accuracyLimit: 100,
  isActive: true,
}

function loadLeaflet(): Promise<void> {
  if (window.L) return Promise.resolve()

  return new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.dataset.leaflet = 'true'
      document.head.appendChild(link)
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-leaflet]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('تعذر تحميل الخريطة.')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.dataset.leaflet = 'true'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('تعذر تحميل الخريطة.'))
    document.body.appendChild(script)
  })
}

function getValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

function normalizeBoolean(value: string) {
  return ['1', 'true', 'yes', 'نعم', 'نشط'].includes(value.trim().toLowerCase())
}

function humanError(message: string) {
  if (message.includes('duplicate') || message.includes('23505')) return 'كود المنطقة أو كود الفرع مستخدم بالفعل.'
  if (message.includes('permission') || message.includes('42501')) return 'ليس لديك صلاحية تنفيذ هذه العملية.'
  if (message.includes('مرتبط بمنطقة أخرى')) return 'مدير المنطقة المحدد مرتبط بمنطقة أخرى. اختر مديرًا غير مرتبط أو غيّر مدير المنطقة من شاشة المناطق.'
  if (message.includes('مدير المنطقة')) return message
  return message
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [view, setView] = useState<'list' | 'form'>('list')
  const [form, setForm] = useState<BranchForm>(emptyForm)
  const [coordinates, setCoordinatesState] = useState<Coordinates | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [listLoading, setListLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [workingId, setWorkingId] = useState('')
  const [locating, setLocating] = useState(false)
  const [searching, setSearching] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [importMessage, setImportMessage] = useState('')
  const [googleMapsValue, setGoogleMapsValue] = useState('')

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<LeafletMarker | null>(null)
  const circleRef = useRef<LeafletCircle | null>(null)
  const coordinatesRef = useRef<Coordinates | null>(null)
  const radiusRef = useRef(form.radius)

  function setCoordinates(value: Coordinates | null) {
    coordinatesRef.current = value
    setCoordinatesState(value)
  }

  async function loadBranches() {
    setListLoading(true)
    setError('')
    const supabase = createClient()
    const [branchesResult, regionsResult, managersResult] = await Promise.all([
      supabase.rpc('app_list_branches'),
      supabase.rpc('app_list_regions'),
      supabase.rpc('app_list_region_manager_candidates'),
    ])

    if (branchesResult.error) {
      setError(humanError(branchesResult.error.message))
      setBranches([])
    } else {
      setBranches((branchesResult.data ?? []) as Branch[])
    }
    if (!regionsResult.error) setRegions(((regionsResult.data ?? []) as Region[]).filter(region => region.is_active))
    if (!managersResult.error) setManagers((managersResult.data ?? []) as Manager[])
    setListLoading(false)
  }

  useEffect(() => {
    void loadBranches()
  }, [])

  useEffect(() => {
    radiusRef.current = form.radius
    if (circleRef.current) circleRef.current.setRadius(form.radius)
  }, [form.radius])

  function placePoint(latitude: number, longitude: number, accuracy: number, source: Coordinates['source'], zoom = 17, lookupAddress = false) {
    const point: [number, number] = [latitude, longitude]
    setCoordinates({ latitude, longitude, accuracy, source })

    if (!mapRef.current || !window.L) return
    mapRef.current.setView(point, zoom)

    if (!markerRef.current) {
      markerRef.current = window.L.marker(point, { draggable: true }).addTo(mapRef.current)
      markerRef.current.on('dragend', event => {
        const dragged = event.target.getLatLng()
        placePoint(dragged.lat, dragged.lng, 0, 'map', 18, true)
      })
    } else {
      markerRef.current.setLatLng(point)
    }

    if (!circleRef.current) {
      circleRef.current = window.L.circle(point, {
        radius: radiusRef.current,
        color: '#7c3aed',
        fillColor: '#a855f7',
        fillOpacity: 0.14,
        weight: 2,
      }).addTo(mapRef.current)
    } else {
      circleRef.current.setLatLng(point).setRadius(radiusRef.current)
    }

    if (lookupAddress) void reverseGeocode(latitude, longitude)
  }

  useEffect(() => {
    if (view !== 'form') return
    let active = true

    loadLeaflet()
      .then(() => {
        if (!active || !mapElementRef.current || mapRef.current || !window.L) return
        const map = window.L.map(mapElementRef.current, { zoomControl: true })
        map.setView(DEFAULT_CENTER, 7)
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map)
        map.on('click', event => placePoint(event.latlng.lat, event.latlng.lng, 0, 'map', 18, true))
        mapRef.current = map
        setMapReady(true)

        const saved = coordinatesRef.current
        if (saved) placePoint(saved.latitude, saved.longitude, saved.accuracy, saved.source, 17)
        setTimeout(() => map.invalidateSize(), 80)
      })
      .catch(caught => setError(caught instanceof Error ? caught.message : 'تعذر تحميل الخريطة.'))

    return () => {
      active = false
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
      circleRef.current = null
      setMapReady(false)
    }
    // Map lifecycle is tied to the form view only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const filteredBranches = useMemo(() => {
    const text = query.trim().toLowerCase()
    return branches.filter(branch => {
      const matchesText = !text || [
        branch.name,
        branch.code,
        branch.region_name ?? '',
        branch.region_code ?? '',
        branch.address ?? '',
      ].some(value => value.toLowerCase().includes(text))
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' && branch.is_active)
        || (statusFilter === 'inactive' && !branch.is_active)
      return matchesText && matchesStatus
    })
  }, [branches, query, statusFilter])

  function openCreate() {
    const onlyRegion = regions.length === 1 ? regions[0] : null
    setForm({
      ...emptyForm,
      regionId: onlyRegion?.id ?? null,
      regionName: onlyRegion?.name ?? '',
      regionCode: onlyRegion?.code ?? '',
      managerId: onlyRegion?.manager_employee_id ?? '',
    })
    setCoordinates(null)
    setGoogleMapsValue('')
    setError('')
    setSuccess('')
    setView('form')
  }

  function openEdit(branch: Branch) {
    const branchRegion = regions.find(region => region.id === branch.region_id)
    setForm({
      id: branch.id,
      regionId: branch.region_id,
      regionName: branch.region_name ?? '',
      regionCode: branch.region_code ?? '',
      managerId: branchRegion?.manager_employee_id ?? '',
      branchName: branch.name,
      branchCode: branch.code,
      address: branch.address ?? '',
      radius: branch.attendance_radius_m,
      accuracyLimit: branch.minimum_gps_accuracy_m,
      isActive: branch.is_active,
    })
    if (branch.latitude !== null && branch.longitude !== null) {
      setCoordinates({
        latitude: Number(branch.latitude),
        longitude: Number(branch.longitude),
        accuracy: 0,
        source: 'saved',
      })
    } else {
      setCoordinates(null)
    }
    setGoogleMapsValue('')
    setError('')
    setSuccess('')
    setView('form')
  }

  function closeForm() {
    setView('list')
    setForm(emptyForm)
    setCoordinates(null)
    setGoogleMapsValue('')
    setError('')
    setSuccess('')
  }

  async function reverseGeocode(latitude: number, longitude: number) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=18&addressdetails=1`,
        { headers: { 'Accept-Language': 'ar' } },
      )
      if (!response.ok) return
      const result = await response.json()
      if (result?.display_name) {
        setForm(current => ({ ...current, address: String(result.display_name) }))
      } else {
        setForm(current => ({ ...current, address: `موقع محدد: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}` }))
      }
    } catch {
      setForm(current => ({ ...current, address: current.address || `موقع محدد: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}` }))
    }
  }

  function getCurrentLocation() {
    setError('')
    setLocating(true)
    if (!navigator.geolocation) {
      setError('المتصفح لا يدعم تحديد الموقع.')
      setLocating(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude, accuracy } = position.coords
        placePoint(latitude, longitude, accuracy, 'gps', 18)
        void reverseGeocode(latitude, longitude)
        setLocating(false)
      },
      locationError => {
        setError(locationError.message || 'تعذر الحصول على الموقع الحالي.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 },
    )
  }

  async function searchAddress() {
    const address = form.address.trim()
    if (!address) {
      setError('اكتب عنوانًا أو اسم مكان للبحث عنه.')
      return
    }

    setSearching(true)
    setError('')
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=eg&q=${encodeURIComponent(address)}`,
        { headers: { 'Accept-Language': 'ar' } },
      )
      if (!response.ok) throw new Error('تعذر البحث عن العنوان الآن.')
      const results = await response.json()
      const result = Array.isArray(results) ? results[0] : null
      if (!result) throw new Error('لم يتم العثور على العنوان. اكتب المحافظة والمدينة والشارع.')

      const latitude = Number(result.lat)
      const longitude = Number(result.lon)
      setForm(current => ({ ...current, address: String(result.display_name ?? address) }))
      placePoint(latitude, longitude, 0, 'search', 17)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر البحث عن العنوان.')
    } finally {
      setSearching(false)
    }
  }


  function extractGoogleCoordinates(value: string): { latitude: number; longitude: number } | null {
    const input = value.trim()
    if (!input) return null

    const valid = (latitude: number, longitude: number) =>
      Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && latitude >= -90
      && latitude <= 90
      && longitude >= -180
      && longitude <= 180

    const makeResult = (latitudeText: string, longitudeText: string) => {
      const latitude = Number(latitudeText)
      const longitude = Number(longitudeText)
      return valid(latitude, longitude) ? { latitude, longitude } : null
    }

    // Accept raw coordinates such as: 30.123456, 31.123456
    const rawMatch = input.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,،]\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (rawMatch) return makeResult(rawMatch[1], rawMatch[2])

    let decoded = input
    try {
      decoded = decodeURIComponent(input)
    } catch {
      // Keep the original text when it is not URL-encoded.
    }

    // Standard Google Maps URL:
    // https://www.google.com/maps/place/.../@30.123456,31.123456,17z
    const atMatch = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    if (atMatch) return makeResult(atMatch[1], atMatch[2])

    // Google Maps data fragment:
    // ...!3d30.123456!4d31.123456
    const dataMatch = decoded.match(/!3d(-?\d+(?:\.\d+)?).*?!4d(-?\d+(?:\.\d+)?)/)
    if (dataMatch) return makeResult(dataMatch[1], dataMatch[2])

    // Query-style links:
    // ?q=30.123456,31.123456
    // ?query=30.123456,31.123456
    try {
      const url = new URL(decoded)
      const queryValue =
        url.searchParams.get('q')
        ?? url.searchParams.get('query')
        ?? url.searchParams.get('ll')

      if (queryValue) {
        const queryMatch = queryValue.match(/(-?\d+(?:\.\d+)?)\s*[,،]\s*(-?\d+(?:\.\d+)?)/)
        if (queryMatch) return makeResult(queryMatch[1], queryMatch[2])
      }
    } catch {
      // Not a complete URL. Continue with generic matching.
    }

    // Last fallback: find a coordinate pair anywhere in the pasted text.
    const genericMatch = decoded.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)/)
    if (genericMatch) return makeResult(genericMatch[1], genericMatch[2])

    return null
  }

  function applyGoogleMapsLocation() {
    setError('')
    setSuccess('')

    const value = googleMapsValue.trim()
    if (!value) {
      setError('الصق رابط Google Maps الكامل أو اكتب الإحداثيات بالشكل: 30.123456, 31.123456')
      return
    }

    const parsed = extractGoogleCoordinates(value)
    if (!parsed) {
      const isShortGoogleLink =
        /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(value)

      setError(
        isShortGoogleLink
          ? 'الرابط المختصر من Google Maps لا يحتوي الإحداثيات داخل النص. افتحه أولًا في Google Maps ثم انسخ الرابط الكامل من شريط العنوان، أو الصق الإحداثيات مباشرة.'
          : 'تعذر استخراج الإحداثيات. الصق رابط Google Maps الكامل الذي يحتوي على @latitude,longitude أو الصق الإحداثيات مباشرة.',
      )
      return
    }

    placePoint(parsed.latitude, parsed.longitude, 0, 'google', 18, true)
    setSuccess('تم تحديد موقع الفرع من إحداثيات Google Maps.')
  }

  function openGoogleMaps() {
    const queryValue = coordinates
      ? `${coordinates.latitude},${coordinates.longitude}`
      : form.address.trim() || form.branchName.trim() || 'Egypt'

    window.open(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryValue)}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!coordinates) {
      setError('حدد موقع الفرع من الخريطة أو استخدم موقعك الحالي.')
      return
    }
    if (!form.regionId || !form.managerId || !form.branchName.trim() || !form.branchCode.trim()) {
      setError('اختر المنطقة ومدير المنطقة، ثم أكمل اسم وكود الفرع.')
      return
    }

    const selectedRegion = regions.find(region => region.id === form.regionId)
    if (!selectedRegion) {
      setError('المنطقة المحددة غير متاحة ضمن صلاحياتك.')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('app_save_branch_with_region_manager', {
      p_branch_id: form.id,
      p_region_id: form.regionId,
      p_manager_employee_id: form.managerId,
      p_region_name: selectedRegion.name,
      p_region_code: selectedRegion.code,
      p_branch_name: form.branchName.trim(),
      p_branch_code: form.branchCode.trim().toUpperCase(),
      p_address: form.address.trim(),
      p_latitude: coordinates.latitude,
      p_longitude: coordinates.longitude,
      p_radius: form.radius,
      p_accuracy_limit: form.accuracyLimit,
      p_is_active: form.isActive,
    })

    if (rpcError) {
      setError(humanError(rpcError.message))
    } else {
      setSuccess(form.id ? 'تم تحديث الفرع بنجاح.' : 'تم إنشاء الفرع بنجاح.')
      await loadBranches()
      setTimeout(() => closeForm(), 650)
    }
    setSaving(false)
  }

  async function toggleActive(branch: Branch) {
    setWorkingId(branch.id)
    setError('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('app_set_branch_active', {
      p_branch_id: branch.id,
      p_is_active: !branch.is_active,
    })
    if (rpcError) setError(humanError(rpcError.message))
    else await loadBranches()
    setWorkingId('')
  }

  async function deleteBranch(branch: Branch) {
    const accepted = window.confirm(`حذف فرع «${branch.name}» نهائيًا؟\nإذا كان مرتبطًا بموظفين أو حضور سيرفض النظام الحذف ويمكنك تعطيله بدلًا من ذلك.`)
    if (!accepted) return

    setWorkingId(branch.id)
    setError('')
    const supabase = createClient()
    const { error: rpcError } = await supabase.rpc('app_delete_branch', { p_branch_id: branch.id })
    if (rpcError) setError(humanError(rpcError.message))
    else await loadBranches()
    setWorkingId('')
  }

  async function importExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImportMessage('جارٍ قراءة الملف...')
    setError('')
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' })

      const rows = rawRows.map(row => ({
        region_name: getValue(row, ['اسم المنطقة', 'region_name', 'Region Name']),
        region_code: getValue(row, ['كود المنطقة', 'region_code', 'Region Code']),
        branch_name: getValue(row, ['اسم الفرع', 'branch_name', 'Branch Name']),
        branch_code: getValue(row, ['كود الفرع', 'branch_code', 'Branch Code']),
        address: getValue(row, ['العنوان', 'address', 'Address']),
        latitude: getValue(row, ['خط العرض', 'latitude', 'Latitude']),
        longitude: getValue(row, ['خط الطول', 'longitude', 'Longitude']),
        attendance_radius_m: getValue(row, ['نطاق الحضور', 'attendance_radius_m', 'Radius']) || '150',
        minimum_gps_accuracy_m: getValue(row, ['أقصى دقة GPS', 'minimum_gps_accuracy_m', 'GPS Accuracy']) || '100',
        is_active: getValue(row, ['نشط', 'is_active', 'Active']),
      })).filter(row => row.branch_code || row.branch_name)

      if (!rows.length) throw new Error('لم يتم العثور على صفوف فروع داخل الملف.')

      setImportMessage(`جارٍ استيراد ${rows.length} صف...`)
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc('app_import_branches', { p_rows: rows })
      if (rpcError) throw rpcError

      const result = data as { inserted?: number; updated?: number; failed?: number; errors?: Array<{ row: number; error: string }> }
      const firstError = result.errors?.[0]
      setImportMessage(`تمت الإضافة: ${result.inserted ?? 0} — تم التحديث: ${result.updated ?? 0} — أخطاء: ${result.failed ?? 0}${firstError ? ` — أول خطأ في الصف ${firstError.row}: ${firstError.error}` : ''}`)
      await loadBranches()
    } catch (caught) {
      setImportMessage('')
      setError(caught instanceof Error ? caught.message : 'تعذر استيراد الملف.')
    }
  }

  async function downloadTemplate() {
    const XLSX = await import('xlsx')
    const headers = [[
      'اسم المنطقة', 'كود المنطقة', 'اسم الفرع', 'كود الفرع', 'العنوان',
      'خط العرض', 'خط الطول', 'نطاق الحضور', 'أقصى دقة GPS', 'نشط',
    ]]
    const instructions = [
      ['تعليمات'],
      ['كود المنطقة وكود الفرع مطلوبان ويجب ألا يتكررا.'],
      ['خط العرض وخط الطول اختياريان، والفرع بدون موقع يفضّل أن يكون غير نشط.'],
      ['قيمة نشط: نعم أو لا.'],
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(headers), 'الفروع')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), 'تعليمات')
    XLSX.writeFile(workbook, 'Emora_Branches_Template.xlsx')
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const rows = branches.map(branch => ({
      'اسم المنطقة': branch.region_name ?? '',
      'كود المنطقة': branch.region_code ?? '',
      'اسم الفرع': branch.name,
      'كود الفرع': branch.code,
      'العنوان': branch.address ?? '',
      'خط العرض': branch.latitude ?? '',
      'خط الطول': branch.longitude ?? '',
      'نطاق الحضور': branch.attendance_radius_m,
      'أقصى دقة GPS': branch.minimum_gps_accuracy_m,
      'نشط': branch.is_active ? 'نعم' : 'لا',
      'عدد الموظفين': branch.employee_count,
    }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'الفروع')
    XLSX.writeFile(workbook, 'Emora_Branches.xlsx')
  }

  if (view === 'form') {
    const sourceText = coordinates?.source === 'gps'
      ? `GPS بدقة ${Math.round(coordinates.accuracy)} متر`
      : coordinates?.source === 'search'
        ? 'تم تحديده من البحث'
        : coordinates?.source === 'google'
          ? 'تم تحديده من Google Maps'
          : coordinates?.source === 'saved'
            ? 'الموقع المحفوظ للفرع'
            : 'تم تحديده يدويًا على الخريطة'

    return (
      <main className="dashboard-content">
        <section className="page-heading">
          <div>
            <span className="eyebrow">الفروع</span>
            <h1>{form.id ? 'تعديل الفرع' : 'إضافة فرع جديد'}</h1>
            <p>البيانات التي تحفظ هنا تُسجّل مباشرة في Supabase.</p>
          </div>
          <button type="button" className="button button-ghost" onClick={closeForm}><X size={18} /> رجوع للقائمة</button>
        </section>

        <form className="branch-layout" onSubmit={submit}>
          <section className="panel branch-form">
            <div className="panel-heading"><div><h2>بيانات الفرع</h2><p>المعلومات التنظيمية والموقع الجغرافي</p></div></div>
            <div className="two-columns">
              <label className="full-column">المنطقة
                <select
                  value={form.regionId ?? ''}
                  onChange={event => {
                    const region = regions.find(item => item.id === event.target.value)
                    setForm(current => ({
                      ...current,
                      regionId: event.target.value || null,
                      regionName: region?.name ?? '',
                      regionCode: region?.code ?? '',
                      managerId: region?.manager_employee_id ?? '',
                    }))
                  }}
                  required
                >
                  <option value="">اختر المنطقة</option>
                  {regions.map(region => <option value={region.id} key={region.id}>{region.name} — {region.code}</option>)}
                </select>
                <small className="field-help">إنشاء المناطق وتعيين المدير يتم من شاشة «المناطق».</small>
              </label>
              <label className="full-column">مدير المنطقة المسؤول عن متابعة الفرع
                <select
                  value={form.managerId}
                  onChange={event => setForm(current => ({ ...current, managerId: event.target.value }))}
                  required
                >
                  <option value="">اختر مدير المنطقة</option>
                  {(() => {
                    const selectedRegion = regions.find(region => region.id === form.regionId)
                    const currentManagerMissing = selectedRegion?.manager_employee_id
                      && !managers.some(manager => manager.id === selectedRegion.manager_employee_id)

                    return (
                      <>
                        {currentManagerMissing && (
                          <option value={selectedRegion.manager_employee_id ?? ''}>
                            {selectedRegion.manager_name ?? 'مدير المنطقة الحالي'}
                          </option>
                        )}
                        {managers.map(manager => {
                          const assignedElsewhere = manager.is_assigned
                            && manager.id !== selectedRegion?.manager_employee_id
                          return (
                            <option value={manager.id} key={manager.id} disabled={assignedElsewhere}>
                              {manager.full_name} — {manager.employee_code}
                              {manager.job_title_name ? ` — ${manager.job_title_name}` : ''}
                              {assignedElsewhere ? ' — مرتبط بمنطقة أخرى' : ''}
                            </option>
                          )
                        })}
                      </>
                    )
                  })()}
                </select>
                <small className="field-help">
                  المدير المختار يصبح مديرًا للمنطقة كلها، فيرى جميع فروعها وموظفيها فقط، ولا يرى فروع المناطق الأخرى.
                </small>
              </label>
              <label>اسم الفرع<input value={form.branchName} onChange={event => setForm(current => ({ ...current, branchName: event.target.value }))} required /></label>
              <label>كود الفرع<input value={form.branchCode} onChange={event => setForm(current => ({ ...current, branchCode: event.target.value.toUpperCase() }))} required /></label>
              <label className="full-column">ابحث بالعنوان أو اسم المكان
                <div className="address-search-row">
                  <input value={form.address} onChange={event => setForm(current => ({ ...current, address: event.target.value }))} placeholder="مثال: الهرم، الجيزة" />
                  <button type="button" className="button button-secondary" onClick={() => void searchAddress()} disabled={searching}>
                    {searching ? <Loader2 className="spin" size={18} /> : <Search size={18} />} {searching ? 'جارٍ البحث...' : 'بحث'}
                  </button>
                </div>
              </label>

              <div className="full-column" style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                  <Link2 size={17} />
                  تحديد دقيق من Google Maps
                </div>
                <div className="address-search-row">
                  <input
                    value={googleMapsValue}
                    onChange={event => setGoogleMapsValue(event.target.value)}
                    placeholder="الصق رابط Google Maps الكامل أو الإحداثيات: 30.123456, 31.123456"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={applyGoogleMapsLocation}
                  >
                    <MapPin size={18} /> تحديد الموقع
                  </button>
                  <button
                    type="button"
                    className="button button-ghost"
                    onClick={openGoogleMaps}
                    title="فتح Google Maps للبحث عن الموقع"
                  >
                    <ExternalLink size={18} /> فتح Google Maps
                  </button>
                </div>
                <small className="field-help">
                  الأفضل: افتح المكان في Google Maps، ثم انسخ الرابط الكامل من شريط العنوان والصقه هنا.
                  الروابط المختصرة من نوع maps.app.goo.gl قد تحتاج فتحها أولًا ثم نسخ الرابط الكامل.
                </small>
              </div>

              <label>نطاق الحضور
                <select value={form.radius} onChange={event => setForm(current => ({ ...current, radius: Number(event.target.value) }))}>
                  {[50, 100, 150, 200, 300, 500].map(value => <option key={value} value={value}>{value} متر</option>)}
                </select>
              </label>
              <label>أقصى دقة GPS مقبولة
                <select value={form.accuracyLimit} onChange={event => setForm(current => ({ ...current, accuracyLimit: Number(event.target.value) }))}>
                  {[30, 50, 75, 100, 150, 200].map(value => <option key={value} value={value}>{value} متر</option>)}
                </select>
              </label>
              <label className="toggle-field full-column">
                <input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />
                <span>الفرع نشط ومتاح للحضور</span>
              </label>
            </div>

            <div className="location-box">
              <div className="location-icon"><MapPin /></div>
              <div><strong>موقع الفرع</strong><p>اضغط على الخريطة أو اسحب العلامة إلى مدخل الفرع.</p></div>
              <button type="button" className="button button-secondary" onClick={getCurrentLocation} disabled={locating}>
                {locating ? <Loader2 className="spin" size={18} /> : <Crosshair size={18} />} {locating ? 'جارٍ التحديد...' : 'استخدام موقعي الحالي'}
              </button>
            </div>

            {coordinates && <div className="coordinates-card"><CheckCircle2 /><div><strong>تم تحديد موقع الفرع</strong><span>Lat: {coordinates.latitude.toFixed(6)} • Lng: {coordinates.longitude.toFixed(6)}</span><small>{sourceText}</small></div></div>}
            {error && <div className="form-error">{error}</div>}
            {success && <div className="form-success"><CheckCircle2 size={18} />{success}</div>}
            <button className="button button-primary button-full" disabled={saving}><Save size={18} /> {saving ? 'جارٍ الحفظ...' : form.id ? 'حفظ التعديلات' : 'إنشاء الفرع'}</button>
          </section>

          <aside className="panel map-preview real-map-panel">
            <div className="real-map" ref={mapElementRef} />
            {!mapReady && <div className="map-loading"><Loader2 className="spin" /> جارٍ تحميل الخريطة...</div>}
            <div className="map-info"><h3>اختيار الموقع على الخريطة</h3><p>{coordinates ? `الدائرة البنفسجية تمثل نطاقًا قدره ${form.radius} متر.` : 'ابحث عن عنوان، الصق موقع Google Maps، أو اضغط على الخريطة.'}</p><div className="map-tip"><strong>مهم</strong><span>ضع العلامة عند مدخل الفرع، وليس في منتصف الشارع. يمكنك الاستعانة بـ Google Maps للوصول للنقطة الدقيقة.</span></div></div>
          </aside>
        </form>
      </main>
    )
  }

  return (
    <main className="dashboard-content">
      <section className="page-heading management-heading">
        <div><span className="eyebrow">بيانات فعلية</span><h1>الفروع</h1><p>{branches.length} فرع مسجل في قاعدة البيانات.</p></div>
        <div className="page-actions">
          <button type="button" className="button button-ghost" onClick={() => void downloadTemplate()}><Download size={18} /> نموذج Excel</button>
          <button type="button" className="button button-ghost" onClick={() => fileInputRef.current?.click()}><Upload size={18} /> استيراد Excel</button>
          <button type="button" className="button button-ghost" onClick={() => void exportExcel()} disabled={!branches.length}><FileSpreadsheet size={18} /> تصدير Excel</button>
          <button type="button" className="button button-primary" onClick={openCreate}><Plus size={18} /> إضافة فرع</button>
          <input ref={fileInputRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={event => void importExcel(event)} />
        </div>
      </section>

      {error && <div className="form-error management-message">{error}</div>}
      {importMessage && <div className="form-success management-message"><CheckCircle2 size={18} />{importMessage}</div>}

      <section className="panel management-toolbar">
        <div className="table-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث باسم أو كود الفرع أو المنطقة..." /></div>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="all">كل الحالات</option>
          <option value="active">الفروع النشطة</option>
          <option value="inactive">الفروع غير النشطة</option>
        </select>
        <button type="button" className="button button-ghost" onClick={() => void loadBranches()} disabled={listLoading}><RefreshCw className={listLoading ? 'spin' : ''} size={18} /> تحديث</button>
      </section>

      <section className="panel data-table-panel">
        {listLoading ? (
          <div className="empty-state"><Loader2 className="spin" size={30} /><strong>جارٍ تحميل الفروع...</strong></div>
        ) : filteredBranches.length === 0 ? (
          <div className="empty-state"><Building2 size={42} /><strong>{branches.length ? 'لا توجد نتائج مطابقة' : 'لا توجد فروع مسجلة'}</strong><span>{branches.length ? 'غيّر البحث أو الفلتر.' : 'ابدأ بإضافة فرع أو استيراد ملف Excel.'}</span>{!branches.length && <button className="button button-primary" onClick={openCreate}><Plus size={18} /> إضافة أول فرع</button>}</div>
        ) : (
          <div className="responsive-table">
            <table className="data-table">
              <thead><tr><th>الفرع</th><th>المنطقة</th><th>مدير المنطقة</th><th>العنوان</th><th>نطاق الحضور</th><th>الموظفون</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {filteredBranches.map(branch => (
                  <tr key={branch.id}>
                    <td><div className="primary-cell"><strong>{branch.name}</strong><span>{branch.code}</span></div></td>
                    <td><div className="primary-cell"><strong>{branch.region_name ?? '—'}</strong><span>{branch.region_code ?? '—'}</span></div></td>
                    <td>{regions.find(region => region.id === branch.region_id)?.manager_name ?? 'لم يتم التعيين'}</td>
                    <td className="wide-cell">{branch.address || 'لم يُسجل عنوان'}</td>
                    <td>{branch.attendance_radius_m} متر</td>
                    <td>{branch.employee_count}</td>
                    <td><span className={`status-badge ${branch.is_active ? 'active' : 'inactive'}`}>{branch.is_active ? 'نشط' : 'غير نشط'}</span></td>
                    <td><div className="row-actions">
                      <button title="تعديل" onClick={() => openEdit(branch)}><Edit3 size={17} /></button>
                      <button title={branch.is_active ? 'تعطيل' : 'تفعيل'} disabled={workingId === branch.id} onClick={() => void toggleActive(branch)}>{workingId === branch.id ? <Loader2 className="spin" size={17} /> : <CircleOff size={17} />}</button>
                      <button className="danger" title="حذف" disabled={workingId === branch.id} onClick={() => void deleteBranch(branch)}><Trash2 size={17} /></button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
