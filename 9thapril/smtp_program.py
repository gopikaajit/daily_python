print("Hello world!")
import smtplib
from email.message import EmailMessage

# Email configuration
smtp_server = 'smtp.gmail.com'  # Change based on your email provider
smtp_port = 587  # 465 for SSL, 587 for TLS
sender_email = 'gopikaajit@gmail.com'
receiver_email = 'devikaajit@example.com'
password = 'ocgx gczv leas qkny'  # Use an App Password if 2FA is on

# Create the email message
msg = EmailMessage()
msg.set_content("Hello, World!")
msg['Subject'] = 'SMTP Hello World'
msg['From'] = sender_email
msg['To'] = receiver_email

# Send the email
try:
    with smtplib.SMTP(smtp_server, smtp_port) as server:
        server.starttls()  # Secure the connection
        server.login(sender_email, password)
        server.send_message(msg)
        print("Email sent successfully!")
except Exception as e:
    print(f"Failed to send email: {e}")
