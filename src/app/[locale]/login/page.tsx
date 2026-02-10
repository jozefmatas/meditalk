'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { HugeiconsIcon } from '@hugeicons/react'
import { Mail01Icon, Loading03Icon, CheckmarkCircle01Icon, AlertCircleIcon } from '@hugeicons/core-free-icons'

export default function LoginPage() {
  const t = useTranslations('login')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setLoading(false)

    if (error) {
      setError(t('errorSending'))
      return
    }

    setSent(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">MediTalk</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <HugeiconsIcon icon={CheckmarkCircle01Icon} size={48} className="text-green-600" />
              <p className="text-center text-sm text-muted-foreground">
                {t('checkEmail')}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <Alert variant="destructive">
                  <HugeiconsIcon icon={AlertCircleIcon} size={16} />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-col gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  {t('emailLabel')}
                </label>
                <InputGroup>
                  <InputGroupAddon>
                    <HugeiconsIcon icon={Mail01Icon} />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="email"
                    type="email"
                    placeholder={t('emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                  />
                </InputGroup>
              </div>
              <Button type="submit" disabled={loading || !email} className="w-full">
                {loading ? (
                  <HugeiconsIcon icon={Loading03Icon} size={20} className="animate-spin" />
                ) : (
                  t('sendLink')
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
