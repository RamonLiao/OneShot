#!/usr/bin/env python3
"""Generate OneShot architecture diagram as PNG."""
from PIL import Image, ImageDraw, ImageFont
import math, os

W, H = 1400, 920
BG = (15, 15, 20)
CARD_BG = (30, 32, 40)
ACCENT_TEAL = (63, 219, 237)
ACCENT_ORANGE = (255, 130, 60)
ACCENT_PURPLE = (160, 90, 255)
ACCENT_GREEN = (0, 194, 48)
ACCENT_BLUE = (100, 160, 255)
TEXT_WHITE = (245, 246, 248)
TEXT_GRAY = (155, 163, 174)
TEXT_DIM = (100, 106, 118)
ARROW_COLOR = (100, 120, 150)
BORDER_SUBTLE = (60, 66, 80)

img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

def get_font(size, bold=False):
    paths = [
        "/System/Library/Fonts/SFPro-Bold.otf" if bold else "/System/Library/Fonts/SFPro-Regular.otf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except:
                pass
    return ImageFont.load_default()

font_title = get_font(28, bold=True)
font_subtitle = get_font(13)
font_heading = get_font(15, bold=True)
font_body = get_font(12)
font_small = get_font(11)
font_label = get_font(10)
font_layer = get_font(11, bold=True)

def rounded_rect(x, y, w, h, fill, border=None, radius=10):
    draw.rounded_rectangle([x, y, x+w, y+h], radius=radius, fill=fill, outline=border, width=2)

def draw_arrow(x1, y1, x2, y2, color=ARROW_COLOR, width=2):
    draw.line([(x1, y1), (x2, y2)], fill=color, width=width)
    angle = math.atan2(y2-y1, x2-x1)
    size = 8
    draw.polygon([
        (x2, y2),
        (x2 - size*math.cos(angle - 0.4), y2 - size*math.sin(angle - 0.4)),
        (x2 - size*math.cos(angle + 0.4), y2 - size*math.sin(angle + 0.4)),
    ], fill=color)

def draw_card(x, y, w, h, title, items, border_color, tagline=None):
    rounded_rect(x, y, w, h, CARD_BG, border_color)
    draw.text((x + w//2, y + 14), title, fill=border_color, font=font_heading, anchor="mt")
    for i, item in enumerate(items):
        draw.text((x + w//2, y + 38 + i*16), item, fill=TEXT_GRAY, font=font_small, anchor="mt")
    if tagline:
        draw.text((x + w//2, y + h - 16), tagline, fill=border_color, font=font_label, anchor="mb")

# ── Title ──
draw.text((W//2, 28), "OneShot — System Architecture", fill=TEXT_WHITE, font=font_title, anchor="mt")
draw.text((W//2, 60), "Confidential Prediction Market  •  World ID + Chainlink CRE", fill=TEXT_DIM, font=font_subtitle, anchor="mt")

# ── Layer 1: User Flow (y=95) ──
draw.text((28, 90), "USER FLOW", fill=TEXT_DIM, font=font_layer)
L1Y = 110
# User
draw_card(60, L1Y, 220, 120, "👤 User (World App)",
    ["World ID verify", "Encrypted bets", "MiniKit deposit"],
    ACCENT_TEAL, "1 person = 1 vote")
# Mini App
draw_card(380, L1Y, 260, 120, "📱 Mini App (Next.js)",
    ["RSA-OAEP encrypt bets", "World ID MiniKit auth", "Position management"],
    ACCENT_PURPLE, "Frontend encrypts — backend blind")
# Backend
draw_card(740, L1Y, 280, 120, "⚙️ Backend API (Next.js)",
    ["World ID v4 verify", "Blind ciphertext storage", "Balance ledger (Turso DB)"],
    ACCENT_ORANGE, "Cannot decrypt — zero knowledge")

# L1 arrows
draw_arrow(280, L1Y+60, 380, L1Y+60, ACCENT_TEAL)
draw_arrow(640, L1Y+60, 740, L1Y+60, ACCENT_PURPLE)

# ── Layer 2: Infrastructure (y=280) ──
draw.text((28, 268), "INFRASTRUCTURE", fill=TEXT_DIM, font=font_layer)
L2Y = 288

# Control Chain
cx_ctrl = 80
rounded_rect(cx_ctrl, L2Y, 440, 130, CARD_BG, BORDER_SUBTLE)
draw.text((cx_ctrl+220, L2Y+14), "⛓️ Control Chain (Base Sepolia)", fill=TEXT_WHITE, font=font_heading, anchor="mt")
draw.text((cx_ctrl+18, L2Y+40), "MarketRegistry.sol", fill=ACCENT_TEAL, font=font_body)
draw.text((cx_ctrl+18, L2Y+58), "  • Market lifecycle (create / close / settle)", fill=TEXT_GRAY, font=font_small)
draw.text((cx_ctrl+18, L2Y+78), "BetIngress.sol", fill=ACCENT_TEAL, font=font_body)
draw.text((cx_ctrl+18, L2Y+96), "  • ciphertextHash on-chain proof", fill=TEXT_GRAY, font=font_small)
draw.text((cx_ctrl+18, L2Y+114), "  • 1 bet per user per market enforced", fill=TEXT_GRAY, font=font_small)

# CRE TEE — narrower, balanced with Control Chain
cx_cre = 620
cre_w = 540
rounded_rect(cx_cre, L2Y, cre_w, 130, (25, 30, 45), ACCENT_GREEN)
draw.text((cx_cre+cre_w//2, L2Y+14), "🛡️ Chainlink CRE (TEE)", fill=ACCENT_GREEN, font=font_heading, anchor="mt")
draw.text((cx_cre+18, L2Y+40), "• Decrypt bets with private key", fill=TEXT_GRAY, font=font_small)
draw.text((cx_cre+18, L2Y+58), "• Calculate payouts in enclave", fill=TEXT_GRAY, font=font_small)
draw.text((cx_cre+18, L2Y+78), "• Oracle auto-settle (Cron)", fill=TEXT_GRAY, font=font_small)
draw.text((cx_cre+18, L2Y+96), "• Multi-chain write to Vaults", fill=TEXT_GRAY, font=font_small)
draw.text((cx_cre+cre_w//2, L2Y+114), "Only TEE can see bet contents", fill=ACCENT_GREEN, font=font_label, anchor="mt")

# L1 → L2 arrows
# Backend → Control Chain
draw_arrow(880, L1Y+120, 400, L2Y, ARROW_COLOR)
draw.text((620, L1Y+142), "placeBet() / setResult()", fill=TEXT_DIM, font=font_label, anchor="mt")

# Backend → CRE (Confidential HTTP) — label offset to avoid overlap
draw_arrow(1020, L1Y+120, 950, L2Y, ACCENT_ORANGE)
draw.text((1048, L1Y+135), "Confidential HTTP", fill=TEXT_DIM, font=font_label, anchor="lt")

# Control Chain → CRE (EVM Log)
draw_arrow(520, L2Y+65, 620, L2Y+65, ARROW_COLOR)
draw.text((540, L2Y+45), "EVM Log trigger", fill=TEXT_DIM, font=font_label)

# ── Layer 3: Vault Chains (y=475) ──
draw.text((28, 455), "PAYOUT LAYER", fill=TEXT_DIM, font=font_layer)
L3Y = 475
chains = [
    ("World Chain", ACCENT_TEAL, 60),
    ("Base Sepolia", ACCENT_BLUE, 380),
    ("Arbitrum Sepolia", ACCENT_PURPLE, 700),
    ("Optimism Sepolia", ACCENT_ORANGE, 1020),
]

for name, color, cx in chains:
    rounded_rect(cx, L3Y, 260, 105, CARD_BG, color)
    draw.text((cx+130, L3Y+14), f"🏦 {name}", fill=color, font=font_heading, anchor="mt")
    draw.text((cx+130, L3Y+38), "Vault.sol", fill=TEXT_WHITE, font=font_body, anchor="mt")
    draw.text((cx+130, L3Y+56), "deposit() / allocate()", fill=TEXT_GRAY, font=font_small, anchor="mt")
    draw.text((cx+130, L3Y+72), "recordPayout() + claim()", fill=TEXT_GRAY, font=font_small, anchor="mt")
    draw.text((cx+130, L3Y+90), "USDC ERC-20", fill=TEXT_DIM, font=font_small, anchor="mt")

# CRE → Vault arrows (fan out from CRE bottom center)
cre_bottom_x = cx_cre + cre_w // 2
cre_bottom_y = L2Y + 130
for name, color, cx in chains:
    target_x = cx + 130
    draw_arrow(cre_bottom_x, cre_bottom_y, target_x, L3Y, ACCENT_GREEN)

draw.text((cre_bottom_x + 60, cre_bottom_y + 20), "Multi-chain Payout Write", fill=ACCENT_GREEN, font=font_label, anchor="mt")

# ── Privacy Flow (bottom) ──
PY = 625
rounded_rect(40, PY, W-80, 150, (20, 22, 30), (50, 55, 70))
draw.text((W//2, PY+16), "🔒 Privacy Model — End-to-End Encrypted Bets", fill=TEXT_WHITE, font=font_heading, anchor="mt")

steps = [
    ("1", "Frontend", "RSA-OAEP\nencrypt bet", ACCENT_PURPLE, 160),
    ("2", "Backend", "Stores blind\nciphertext", ACCENT_ORANGE, 400),
    ("3", "On-chain", "Only keccak256\nhash recorded", ACCENT_BLUE, 640),
    ("4", "CRE TEE", "Decrypt &\nsettle privately", ACCENT_GREEN, 880),
    ("5", "Payout", "Multi-chain\nVault claims", ACCENT_TEAL, 1120),
]

for num, title, desc, color, sx in steps:
    cy = PY + 58
    draw.ellipse([sx-15, cy-15, sx+15, cy+15], fill=color)
    draw.text((sx, cy), num, fill=BG, font=font_heading, anchor="mm")
    draw.text((sx, cy+28), title, fill=color, font=font_body, anchor="mt")
    for i, line in enumerate(desc.split("\n")):
        draw.text((sx, cy+44+i*14), line, fill=TEXT_GRAY, font=font_small, anchor="mt")

for i in range(len(steps)-1):
    x1 = steps[i][4] + 28
    x2 = steps[i+1][4] - 28
    draw_arrow(x1, PY+58, x2, PY+58, ARROW_COLOR)

# ── Watermark ──
draw.text((W//2, H-16), "OneShot — Chainlink CRE Hackathon 2026", fill=TEXT_DIM, font=font_label, anchor="mb")

out_path = os.path.join(os.path.dirname(__file__), "architecture.png")
img.save(out_path, "PNG", quality=95)
print(f"Saved to {out_path} ({W}x{H})")
