param(
  [Parameter(Mandatory = $true)]
  [string]$FunctionUrl,

  [Parameter(Mandatory = $true)]
  [string]$WebhookSecret,

  [Parameter(Mandatory = $true)]
  [string]$FieldPaymentAccountId,

  [Parameter(Mandatory = $false)]
  [string]$ProviderCode = 'mercadopago',

  [Parameter(Mandatory = $false)]
  [string]$ExternalOrderId = 'ORD-1001',

  [Parameter(Mandatory = $false)]
  [string]$PaymentId = 'PAY-1001',

  [Parameter(Mandatory = $false)]
  [decimal]$Amount = 25000,

  [Parameter(Mandatory = $false)]
  [string]$Currency = 'CLP',

  [Parameter(Mandatory = $false)]
  [string]$EventTitle = 'Domingo Milsim',

  [Parameter(Mandatory = $false)]
  [string]$EventDate = '',

  [Parameter(Mandatory = $false)]
  [string]$GuestNickname = 'Invitado Uno',

  [Parameter(Mandatory = $false)]
  [string]$GuestRut = '12345678K',

  [Parameter(Mandatory = $false)]
  [switch]$RunIdempotencyCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($EventDate)) {
  $EventDate = (Get-Date).ToString('yyyy-MM-dd')
}

$idempotencyKey = "smoke-$ExternalOrderId-v1"
$paidAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

$payloadObject = @{
  metadata = @{
    field_payment_account_id = $FieldPaymentAccountId
    event_title = $EventTitle
    event_date = $EventDate
  }
  order = @{
    external_order_id = $ExternalOrderId
  }
  payment = @{
    payment_id = $PaymentId
    status = 'approved'
    amount = [decimal]$Amount
    currency = $Currency
    paid_at = $paidAt
  }
  customer = @{
    email = 'jugador1@correo.cl'
    name = 'Jugador Uno'
    phone = '+56911111111'
  }
  registrations = @(
    @{
      guest_nickname = $GuestNickname
      guest_rut = $GuestRut
      guest_blood_group = 'O+'
      is_minor = $false
    }
  )
}

$payload = $payloadObject | ConvertTo-Json -Depth 8 -Compress

$hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($WebhookSecret))
$hashBytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))
$signature = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })

$headers = @{
  'x-provider-code' = $ProviderCode
  'x-idempotency-key' = $idempotencyKey
  'x-signature' = $signature
}

Write-Host '=== Primera ejecucion webhook ==='
Write-Host "Function URL: $FunctionUrl"
Write-Host "Provider: $ProviderCode"
Write-Host "Idempotency key: $idempotencyKey"

$response1 = Invoke-RestMethod -Method Post -Uri $FunctionUrl -ContentType 'application/json' -Headers $headers -Body $payload
$response1 | ConvertTo-Json -Depth 8

if ($RunIdempotencyCheck) {
  Write-Host "`n=== Segunda ejecucion (idempotencia) ==="
  $response2 = Invoke-RestMethod -Method Post -Uri $FunctionUrl -ContentType 'application/json' -Headers $headers -Body $payload
  $response2 | ConvertTo-Json -Depth 8
}
