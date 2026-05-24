import cv2
import time

# Forcing AVFoundation
backend = cv2.CAP_AVFOUNDATION

print("Attempting to open camera with backend:", backend)
cap = cv2.VideoCapture(0, backend)

# Give the camera time to initialize, especially for Continuity Camera
time.sleep(2)

if not cap.isOpened():
    print("FATAL: Cannot open camera. Exiting.")
    exit()

print("Camera opened successfully. Trying to read first frame.")

# Try to read a few frames to give it a chance to start streaming
ret = False
for i in range(10):
    ret, frame = cap.read()
    if ret:
        print(f"Successfully read frame on attempt {i+1}.")
        break
    else:
        print(f"Attempt {i+1}: Can't receive frame.")
        time.sleep(0.5)

if not ret:
    print("FATAL: Failed to read frame after multiple attempts. Exiting.")
    cap.release()
    exit()


print("Starting feed...")
while True:
    # Capture frame-by-frame
    ret, frame = cap.read()

    # if frame is read correctly ret is True
    if not ret:
        print("Error: Lost connection to camera stream. Exiting ...")
        break

    # Display the resulting frame
    cv2.imshow('Camera Debug', frame)

    # Exit if 'q' is pressed
    if cv2.waitKey(1) == ord('q'):
        print("'q' pressed, releasing camera and closing window.")
        break

# When everything done, release the capture
cap.release()
cv2.destroyAllWindows()
print("Script finished.")
