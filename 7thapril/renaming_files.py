import os
# print("Hello world!")
path_directory="C:/Users/USER/Documents/daily_python/7thapril/folderfulloffiles"
for filename in os.listdir(path_directory):
    
    print(filename)
    newname=filename.replace(".txt","_new.txt")
    os.rename((path_directory+"/" + filename),(path_directory+"/" + newname))

for filename in os.listdir(path_directory):
    print(filename)
